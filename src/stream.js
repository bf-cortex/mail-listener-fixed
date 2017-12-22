import { MailParser } from 'mailparser';
import { Transform } from 'stream';

export default class EMLStream extends Transform {

    constructor(options) {
        super();
        this.mail = {
            attachments: []
        };
        this.options = options || {
                keepCidLinks: false,
                downloadAttachments: false
            };
        this._buffer = new Buffer('');
        this._parser = new MailParser(options);
        this._parser.on('headers', headers => {
            this.mail.headers = headers;
        });
        this._parser.on('data', data => {
            if (data.type === 'text') {
                Object.keys(data).forEach(key => {
                    if (['text', 'html', 'textAsHtml'].includes(key)) {
                        this.mail[key] = data[key];
                    }
                });
            }
            if (data.type === 'attachment') {
                if (this.options.downloadAttachments) {
                    this.mail.attachments.push(data);
                    this.emit('attachment', data);
                }

                let chunklen = 0;
                let chunks = [];

                data.content.on('readable', () => {
                    let chunk;
                    while ((chunk = data.content.read()) !== null) {
                        chunklen += chunk.length;
                        chunks.push(chunk);
                    }
                });
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks, chunklen);
                    data.release();
                });
            }
        });
        this._parser.on('end', () => {
            ['subject', 'references', 'date', 'to', 'from', 'to', 'cc', 'bcc', 'message-id', 'in-reply-to', 'reply-to'].forEach(key => {
                if (this.mail.headers.has(key)) this.mail[key.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = this.mail.headers.get(key);
            });

            this.mail.eml = this._buffer.toString('utf-8');

            if (this.options.keepCidLinks) {
                this.emit('result', this.mail);
                return this.end();
            }

            this._parser.updateImageLinks(
                (attachment, done) => done(false, 'data:' + attachment.contentType + ';base64,' + attachment.content.toString('base64')),
                (err, html) => {
                    if (err) {
                        this.emit('result', this.mail);
                        this.emit('error', err);
                        return this.end();
                    }
                    this.mail.html = html;
                    this.emit('result', this.mail);
                    this.end();
                }
            );
        });
        this.pipe(this._parser);
    }

    _transform(chunk, encoding, done) {
        this._buffer = Buffer.concat([this._buffer, chunk]);
        this.push(chunk);
        return done();
    }

}
