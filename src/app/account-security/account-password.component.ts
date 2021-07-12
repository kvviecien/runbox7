// --------- BEGIN RUNBOX LICENSE ---------
// Copyright (C) 2016-2018 Runbox Solutions AS (runbox.com).
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
import { Component } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RMM } from '../rmm';
import { share, timeout } from 'rxjs/operators';

@Component({
    selector: 'app-account-password',
    styleUrls: ['account.security.component.scss'],
    templateUrl: 'account-password.component.html',
})
export class AccountPasswordComponent {
    old_password: string;
    new_password: string;
    confirm_password: string;
    error: string;
    is_busy: boolean;

    constructor(public snackBar: MatSnackBar, public rmm: RMM) {
        this.rmm.me.load();
    }

    check_password(old_password = this.old_password, new_password = this.new_password, confirm_password = this.confirm_password) {
        if (old_password && new_password && confirm_password) {
            if (new_password === confirm_password) {
                if (new_password.length >= 8 && new_password.length <= 64) {
                    if (/[a-z]/i.test(new_password)) {
                        if (/[0-9]/i.test(new_password)) {
                            if (/[#?!@$%^&*-]/i.test(new_password)) {
                                this.error = undefined;
                                this.update_password(old_password, new_password, confirm_password);
                            } else {
                                this.error = 'Must contain at least 1 special character';
                            }
                        } else {
                            this.error = 'Must contain at least 1 numeric character';
                        }
                    } else {
                        this.error = 'Must contain at least 1 alphabetical character';
                    }
                } else {
                    this.error = 'Must be 8-64 characters long';
                }
            } else {
                this.error = "Passwords don't match";
            }
        } else {
            this.error = 'Fields can not be empty';
        }
    }

    update_password(old_password: string, new_password: string, confirm_password: string) {
        this.is_busy = true;
        const values = {
            old_password: old_password,
            password: new_password,
            password_confirm: confirm_password,
        };

        const req = this.rmm.ua.http.put('/rest/v1/account/password', values).pipe(timeout(60000), share());
        req.subscribe((reply) => {
            if (reply['status'] === 'success') {
                this.show_notification('Password updated', 'Dismiss');
            } else if (reply['status'] === 'error') {
                this.error = reply['field_errors'][Object.keys(reply['field_errors'])[0]];
                return;
            }
        });
        return req;
    }

    show_notification(message, action) {
        this.snackBar.open(message, action, {
            duration: 2000,
        });
    }
}
