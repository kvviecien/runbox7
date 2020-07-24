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

import { Injectable } from '@angular/core';
import { StorageService } from '../storage.service';
import { ReplaySubject } from 'rxjs';
import { take } from 'rxjs/operators';

@Injectable()
export class HintService {
    hintsSeen = new ReplaySubject<any>(1);

    constructor(
        private storage: StorageService,
    ) {
        storage.get('hintsSeen').then(seen => {
            this.hintsSeen.next(seen || {});
        });

        this.hintsSeen.subscribe(seen => {
            this.storage.set('hintsSeen', seen);
        });
    }

    markAsSeen(hint: string) {
        this.hintsSeen.pipe(take(1)).subscribe(seen => {
            seen[hint] = true;
            this.hintsSeen.next(seen);
        });
    }

    shouldShow(hint: string): Promise<boolean> {
        return new Promise((r, _) => {
            this.hintsSeen.pipe(take(1)).subscribe(
                seen => r(!seen[hint])
            );
        });
    }
}
