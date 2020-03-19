// --------- BEGIN RUNBOX LICENSE ---------
// Copyright (C) 2016-2019 Runbox Solutions AS (runbox.com).
//
// This file is part of Runbox 7.
//
// Runbox 7 is free software: You can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// Runbox 7 is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Runbox 7. If not, see <https://www.gnu.org/licenses/>.
// ---------- END RUNBOX LICENSE ----------

import { CalendarEvent } from 'angular-calendar';
import { EventColor } from 'calendar-utils';

import * as moment from 'moment';
import 'moment-timezone';
import * as ICAL from 'ical.js';

export class RunboxCalendarEvent implements CalendarEvent {
    id?:       string;

    // all recurrences of an event will have a parent set to the original one
    parent?: RunboxCalendarEvent;

    color     = {} as EventColor;
    draggable = true;

    // we need those separately from start/end
    // start and end are for display pursposes only,
    // and will be different from dtstart/dtend in
    // recurring events
    calendar:  string;

    ical: ICAL.Component;
    event: ICAL.Event;

    get title(): string {
        return this.event.summary;
    }

    set title(value: string) {
        this.event.summary = value;
    }

    get location(): string {
        return this.event.location;
    }

    set location(value: string) {
        this.event.location = value;
    }

    get description(): string {
        return this.event.description;
    }

    set description(value: string) {
        this.event.description = value;
    }

    get dtstart(): moment.Moment {
        return this.icalTimeToLocalMoment(this.event.startDate);
    }

    set dtstart(value: moment.Moment) {
        const allDay = this.allDay;
        this.event.startDate = ICAL.Time.fromJSDate(value.toDate());
        this.allDay = allDay;
    }

    get dtend(): moment.Moment {
        return this.event.endDate
            ? this.icalTimeToLocalMoment(this.event.endDate)
            : undefined;
    }

    set dtend(value: moment.Moment) {
        const allDay = this.allDay;
        this.event.endDate = value ? ICAL.Time.fromJSDate(value.toDate()) : undefined;
        this.allDay = allDay;
    }

    // angular-calendar compatibility

    get start(): Date {
        return this.dtstart.toDate();
    }

    get end(): Date {
        if (!this.dtend) {
            return undefined;
        }

        // GH-252 workaround until https://github.com/mattlewis92/angular-calendar/issues/1192 solves it better :)
        if (this.dtend.diff(this.dtstart, 'minutes') < 30) {
            return moment(this.dtstart).add(30, 'minutes').toDate();
        }

        const shownEnd = moment(this.dtend);
        if (this.allDay) {
            shownEnd.subtract(1, 'days');
        } else {
            shownEnd.subtract(1, 'seconds');
        }
        return shownEnd.toDate();
    }

    get allDay(): boolean {
        // isDate in ICAL.Event means "has no time"
        return this.event.startDate.isDate;
    }

    get recurringFrequency(): string {
        const recur = this.event.component.getFirstPropertyValue('rrule');
        return recur ? recur.freq : '';
    }

    set recurringFrequency(frequency: string) {
        this.event.component.removeProperty('rrule');
        if (frequency !== '') {
            this.event.component.addPropertyWithValue('rrule', new ICAL.Recur({ freq: frequency }));
        }
    }

    set allDay(value) {
        this.event.startDate.isDate = value;
        if (this.event.endDate) {
            this.event.endDate.isDate = value;
        }
        // I know this looks silly, but without this
        // ICAL.Event will not notice the isDate change
        // and the event metadata will still be off
        this.event.startDate = this.event.startDate;
        this.event.endDate   = this.event.endDate;
    }

    static fromIcal(id: string, ical: string): RunboxCalendarEvent {
        return new this(id, ICAL.parse(ical));
    }

    // creates an unnamed event for today
    static newEmpty(): RunboxCalendarEvent {
        return new this(
            undefined,
            [ 'vcalendar', [], [
                [ 'vevent',
                    [
                        [ 'dtend',   {}, 'date-time', '2019-10-02T14:00:00' ],
                        [ 'dtstart', {}, 'date-time', '2019-10-02T12:00:00' ],
                        [ 'summary', {}, 'text', '' ] ],
                    []
                ]
            ] ]
        );
    }

    static newMultiple(ical: string): RunboxCalendarEvent[] {
        const comp = new ICAL.Component(ICAL.parse(ical));
        return comp.getAllSubcomponents('vevent').map(
            c => new RunboxCalendarEvent(undefined, c.toJSON())
        );
    }

    constructor(id: string, jcal: any) {
        this.id = id;
        if (this.id) {
            this.calendar = this.id.split('/')[0];
        }

        this.ical = new ICAL.Component(jcal);
        this.event = new ICAL.Event(this.ical.getFirstSubcomponent('vevent'));

        // extract and register all timezones included so that we can use them for conversion later.
        // Without this, ICAL.Time.convertToZone will not work
        if (this.ical.getFirstSubcomponent('vtimezone')) {
            for (const tzComponent of this.ical.getAllSubcomponents('vtimezone')) {
                const tz = new ICAL.Timezone({
                    tzid:      tzComponent.getFirstPropertyValue('tzid'),
                    component: tzComponent,
                });

                if (!ICAL.TimezoneService.has(tz.tzid)) {
                    ICAL.TimezoneService.register(tz.tzid, tz);
                }
            }
        }
    }

    clone(): RunboxCalendarEvent {
        return RunboxCalendarEvent.fromIcal(this.id, this.toIcal());
    }

    recurrences(from: Date, to: Date): RunboxCalendarEvent[] {
        const iter = this.event.iterator();
        let next: any;
        const events = [];
        while (next = iter.next()) {
            const recurrenceMoment = this.icalTimeToLocalMoment(next);
            if (recurrenceMoment.isBefore(from)) {
                continue;
            }
            if (recurrenceMoment.isAfter(to)) {
                break;
            }
            const details = this.event.getOccurrenceDetails(next);
            if (details) {
                // clone, but swap the "main" event to the current recurrence
                events.push(this.recurrenceFrom(details));
            }
        }

        return events;
    }

    recurrenceFrom(details: ICAL.Event.occurrenceDetails): RunboxCalendarEvent {
        const copy  = this.clone();
        copy.parent = this;

        // This is really ugly, but ICAL.js is oversharing these,
        // so we need a proper copy of the details.item ICAL.Event.
        // Naturally, like many other ICAL.js objects,
        // this one doesn't have a clone() either :)
        const eventComponent = ICAL.Component.fromString(details.item.component.toString());
        copy.event = new ICAL.Event(eventComponent);

        copy.event.startDate = details.startDate;
        copy.event.endDate   = details.endDate;

        return copy;
    }

    addException(exception: RunboxCalendarEvent) {
        const date = exception.event.component.getFirstProperty('dtstart');
        // There is no API for "just change the name of the property",
        // so this is probably better than messing with internals.
        let stringified = date.toICALString();
        stringified = stringified.replace(/^DTSTART/, 'EXDATE');
        const exdate = ICAL.Property.fromString(stringified);
        this.event.component.addProperty(exdate);
    }

    toIcal(): string {
        return this.ical.toString();
    }

    // returns jCal
    toJSON(): any {
        return {
            id:       this.id,
            calendar: this.calendar,
            jcal:     this.ical.toJSON(),
        };
    }

    private icalTimeToLocalMoment(time: ICAL.Time): moment.Moment {
        if (!time.timezone) {
            // assume that the event is in localtime already
            return moment(time.toString());
        } else {
            // Theoretically, ICAL.Timezone.localTimezone exists.
            // Practically, it does not do anything. Let's go to UTC first.
            const utc = time.convertToZone(ICAL.Timezone.utcTimezone);
            // TODO localzone should perhaps be configurable
            return moment.utc(utc.toString()).tz(moment.tz.guess());
        }
    }
}
