import EventEmitter from 'events';
import EMLStream from './stream';
import IMAP from 'imap';

import { defaultsDeep } from 'lodash';
import { writeFile } from 'fs';
import * as path from 'path';

const debug = require('debug')('imap:listener');

export default class MailListener extends EventEmitter {

    static formatDate(date) {
        if (!date) date = new Date(0);
        return date.toISOString().split('T')[0];
    }
    
    constructor(options) {
        super();
        this.retry = 0;
        this.lastUID = 0;
        this.busy = false;
        this.forceStop = false;
        this.haveNewEmails = false;
        this.defaultOptions = {
            filter: ['UNSEEN'],
            mailbox: 'INBOX',
            setSince: true,
            markSeen: false,
            setFlags: false,
            fetchFromNow: true,
            fetchOnStart: false,
            parserOptions: {
                keepCidLinks: false,
                streamAttachments: false,
                downloadAttachments: false
            },
            attachmentOptions: {
                directory: '',
                stream: null
            },
            imapOptions: {
                connTimeout: 10000,
                authTimeout: 5000,
                retryDelay: 1000,
                keepalive: true,
                tlsOptions: {},
                debug: debug,
                maxRetry: 3
            }
        };
        this.options = defaultsDeep(options, this.defaultOptions);
        this.options.filter = typeof this.options.filter === 'string' ? [this.options.filter] : this.options.filter;
        this.options.parserOptions.streamAttachments = this.options.parserOptions.downloadAttachments && this.options.attachmentOptions.stream;
        this.imap = new IMAP(this.options.imapOptions);
        this.imap.on('error', this.onError.bind(this));
        this.imap.on('close', this.onClose.bind(this));
        this.imap.on('ready', this.onReady.bind(this));
        this.lastFetch = this.options.fetchFromNow;
    }

    onError(err) {
        this.emit('error', err);
    }

    onClose() {
        if (!this.forceStop && this.retry < this.options.imapOptions.maxRetry) {
            setTimeout(() => {
                debug("Trying to establish imap connection again...");
                this.start()
            }, this.options.imapOptions.retryDelay);
            return this.retry++;
        }
        this.emit('disconnected'); debug('disconnected');
        this.forceStop = false;
        this.retry = 0;
    }

    onReady() {
        this.imap.openBox(this.options.mailbox, false, (err, box) => {
            if (err) return this.onError(err);
            this.lastUID = box.uidnext - 1;
            this.emit('connected'); debug('connected');
            if (this.options.fetchOnStart) this.search();
            this.imap.on('mail', this.onMail.bind(this));
            this.imap.on('update', this.onMail.bind(this));
            this.retry = 0;
        });
    }

    onMail() {
        if (!this.haveNewEmails && !this.busy) {
            this.busy = true;
            this.search();
        }
        else if (this.busy) this.haveNewEmails = true;
    }
    
    search() {
        let filter = this.options.filter.slice();
        if (this.lastFetch === true) this.lastFetch = new Date();
        if (this.options.setSince) filter.push(["SINCE", MailListener.formatDate(this.lastFetch)]);
        this.imap.search(filter, (err, results) => {
            results = results.filter(x => x > this.lastUID);
            if (err) return this.onError(err);
            this.lastFetch = new Date();
            if (results.length > 0) {
                if (this.options.setFlags) {
                    this.imap.setFlags(results, ['\\Seen'], err => {
                        if (err) this.onError(err);
                    });
                }
                let fetch = this.imap.fetch(results, {
                    markSeen: this.options.markSeen,
                    bodies: ''
                });
                fetch.on('message', (msg, seg) => {
                    let attributes = {};
                    msg.once('attributes', attr => {
                        attributes = attr;
                    });
                    msg.once('body', stream => {
                        let emlStream = new EMLStream(this.options.parserOptions);
                        emlStream.on('attachment', attachment => {
                            if (!this.options.parserOptions.streamAttachments && this.options.parserOptions.downloadAttachments && attachment) {
                                writeFile(this.options.attachmentOptions.directory + attachment.generatedFileName, attachment.content, err => {
                                    if (!err) {
                                        attachment.path = path.resolve(this.options.attachmentOptions.directory + attachment.generatedFileName);
                                        this.emit('attachment', attachment);
                                        return;
                                    }
                                    this.onError(err);
                                });
                            }
                        });
                        emlStream.on('result', mail => {
                            if (attributes && attributes.uid && attributes.uid > this.lastUID) {
                                this.lastUID = attributes.uid;
                            }
                            this.emit('mail', mail, seg, attributes);
                        });
                        emlStream.on('error', err => {
                            this.onError(err);
                        });
                        stream.pipe(emlStream);
                    });
                });
                fetch.once('error', err => {
                    this.onError(err);
                });
                fetch.once('end', () => {
                    debug('all processed');
                    if (this.haveNewEmails) {
                        this.haveNewEmails = false;
                        return this.search();
                    }
                    this.busy = false;
                });
                return;
            }
            if (this.haveNewEmails) {
                this.haveNewEmails = false;
                return this.search();
            }
            this.busy = false;
        });
    }
    
    start() {
        debug('detaching existing listener');
        this.imap.removeAllListeners('update');
        this.imap.removeAllListeners('mail');

        debug('calling imap connect');
        this.imap.connect();
    }
    
    stop() {
        this.forceStop = true;
        this.imap.end();
    }
    
}
