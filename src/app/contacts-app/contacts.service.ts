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

import { ContactSyncResult, RunboxWebmailAPI } from '../rmmapi/rbwebmail';
import { StorageService } from '../storage.service';
import { Contact } from './contact';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { Subject, ReplaySubject } from 'rxjs';
import { take } from 'rxjs/operators';
import * as moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import { Md5 } from 'ts-md5/dist/md5';

export class Settings {
    get showDragHelpers(): boolean {
        return !!localStorage.getItem('contacts.showDragHelpers');
    }

    set showDragHelpers(value: boolean) {
        localStorage.setItem('contacts.showDragHelpers', value ? '1' : '');
    }
}

interface AvatarCacheEntry {
    url:       string|null;
    timestamp: number;
}


@Injectable()
export class ContactsService implements OnDestroy {
    contactsSubject    = new ReplaySubject<Contact[]>(1);
    contactsByEmail    = new ReplaySubject<any>(1);
    contactCategories  = new ReplaySubject<string[]>(1);
    informationLog     = new Subject<string>();
    errorLog           = new Subject<HttpErrorResponse>();
    migratingContacts  = 0;

    settings = new Settings();
    syncInterval: any;
    syncIntervalSeconds = 180;
    syncToken: string;
    lastUpdate: moment.Moment;

    /* This caches avatar URLs, or `null`s in their absence.
     * Mostly useful for avatars not available in Contacts,
     * and loaded from external services like gravatar.
     *
     * Putting (gr)avatar URLs in <img src's> will cache them nicely,
     * except if they 404d last time around
     * (which will realistically happen most of the time).
     *
     * 404d avatars will get re-requested every single time,
     * wasting time and bandwidth for more and more useless 404s.
     * To avoid this, we cache the fact that they don't exist
     * (storing `null` in `avatarCache`) so that various components
     * know that there's no need to create <img> at all,
     * and no useless requests will be performed.
     */
    avatarCache: { [email: string]: AvatarCacheEntry } = {};

    constructor(
        private rmmapi: RunboxWebmailAPI,
        private storage: StorageService,
    ) {
        storage.get('contactsCache').then(cache => {
            if (!cache || typeof cache !== 'object' || cache.version !== 3) {
                return;
            }
            const contacts = cache.contacts.map((c: any) => Contact.fromVcard(c[0], c[1]));
            this.syncToken = cache.syncToken;
            this.processContacts(contacts);
        }).finally(() => {
            this.syncInterval = setInterval(() => {
                this.reload();
            }, this.syncIntervalSeconds * 1000);
            this.reload();
        });

        storage.get('avatarCache').then(cache => {
            if (cache) {
                this.avatarCache = cache;
            }
        });
    }

    apiErrorHandler(e: HttpErrorResponse): void {
        this.errorLog.next(e);
    }

    private cacheAvatarUrl(email: string, url: string) {
        this.avatarCache[email] = { url, timestamp: (new Date()).getTime() };
        this.storage.set('avatarCache', this.avatarCache);
    }

    private trashAvatarCacheFor(email: string) {
        this.avatarCache[email] = null;
        this.storage.set('avatarCache', this.avatarCache);
    }

    ngOnDestroy() {
        clearInterval(this.syncInterval);
    }

    processContacts(contacts: Contact[]): void {
        this.contactsSubject.next(contacts);

        const byEmail    = {};
        const categories = {};
        for (const c of contacts) {
            for (const cat of c.categories) {
                categories[cat] = true;
            }
            for (const e of c.emails) {
                byEmail[e.value] = c;
                this.trashAvatarCacheFor(e.value);
            }
        }
        this.contactCategories.next(Object.keys(categories));
        this.contactsByEmail.next(byEmail);
        this.saveCache(contacts);
        this.lastUpdate = moment();
    }

    reload(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.rmmapi.syncContacts(this.syncToken).subscribe(
                (syncResult: ContactSyncResult) => {
                    this.migratingContacts = syncResult.toMigrate;
                    if (!this.syncToken) {
                        // initial sync. Grab whatever's in .added and call it a day
                        this.syncToken = syncResult.newSyncToken;
                        this.processContacts(syncResult.added);
                        resolve();
                    } else if (this.syncToken === syncResult.newSyncToken) {
                        // everything up-to-date, nothing to do
                        resolve();
                    } else {
                        // not our first rodeo: take the current list and update it
                        this.contactsSubject.pipe(take(1)).subscribe(currentContacts => {
                            const contactsByUrl: { [key: string]: Contact } = {};
                            for (const c of currentContacts) {
                                contactsByUrl[c.url || c.id] = c;
                            }
                            for (const url of syncResult.removed) {
                                delete contactsByUrl[url];
                            }
                            for (const c of syncResult.added) {
                                contactsByUrl[c.url || c.id] = c;
                            }

                            const newContacts = Object.values(contactsByUrl);

                            this.syncToken = syncResult.newSyncToken;
                            this.processContacts(newContacts);
                            resolve();
                        });
                    }
                },
                e => {
                    this.apiErrorHandler(e);
                    reject();
                }
            );
        });
    }

    saveCache(contacts: Contact[]): void {
        this.storage.set('contactsCache', {
            contacts:  contacts.map(c => [c.url, c.vcard()]),
            syncToken: this.syncToken,
            version:   3,
        });
    }

    saveContact(contact: Contact): Promise<string> {
        return new Promise((resolve, reject) => {
            if (contact.url) {
                console.log('Modifying contact', contact.id);
                this.rmmapi.modifyContact(contact).subscribe(() => {
                    this.informationLog.next('Contact modified successfuly');
                    console.log('Contact modified');
                    this.reload().then(() => resolve(contact.id));
                }, e => {
                    this.apiErrorHandler(e);
                    reject();
                });
            } else {
                if (!contact.id) {
                    contact.id = uuidv4().toUpperCase();
                }

                this.rmmapi.addNewContact(contact).subscribe(url => {
                    this.informationLog.next('New contact has been created');
                    contact.url = url;
                    this.reload().then(() => resolve(contact.id));
                }, e => {
                    this.apiErrorHandler(e);
                    reject();
                });
            }
        });
    }

    deleteContact(contact: Contact): Promise<void> {
        console.log('Contact.service deleting', contact.url);
        return new Promise<void>((resolve, reject) => {
            this.rmmapi.deleteContact(contact).subscribe(() => {
                this.reload().then(() => resolve());
            }, e => {
                this.apiErrorHandler(e);
                reject();
            });
        });
    }

    deleteMultiple(contacts: Contact[]): Promise<void[]> {
        return Promise.all(contacts.map(c => this.deleteContact(c)));
    }

    // returns an URL or null if no avatar is available
    async lookupAvatar(email: string): Promise<string> {
        // TODO: skip if timestamp too old
        if (this.avatarCache[email]) {
            return Promise.resolve(this.avatarCache[email].url);
        }

        const contact = await this.lookupContact(email);
        const photoUrl = contact ? contact.photo : null;
        if (photoUrl) {
            this.cacheAvatarUrl(email, photoUrl);
            return Promise.resolve(photoUrl);
        }

        const hash = Md5.hashStr(email.toLowerCase());
        const url = 'https://gravatar.com/avatar/' + hash + '?d=404';

        return fetch(url).then(response => {
            const resolvedUrl = response.ok ? url : null;
            this.cacheAvatarUrl(email, resolvedUrl);
            return Promise.resolve(this.avatarCache[email].url);
        });
    }

    lookupContact(email: string): Promise<Contact> {
        return new Promise((resolve, reject) => {
            this.contactsByEmail.subscribe(cby => {
                resolve(cby[email]);
            }, e => { this.apiErrorHandler(e); reject(); });
        });
    }

    lookupByUUID(uuid: string): Promise<Contact> {
        return new Promise((resolve, _) => {
            this.contactsSubject.pipe(take(1)).subscribe(contacts => {
                for (const c of contacts) {
                    if (uuid.toLowerCase() === c.id) {
                        resolve(c);
                        return;
                    }
                }
                resolve(null);
            });
        });
    }
}
