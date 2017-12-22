'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _mailparser = require('mailparser');

var _stream = require('stream');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EMLStream = function (_Transform) {
    _inherits(EMLStream, _Transform);

    function EMLStream(options) {
        _classCallCheck(this, EMLStream);

        var _this = _possibleConstructorReturn(this, (EMLStream.__proto__ || Object.getPrototypeOf(EMLStream)).call(this));

        _this.mail = {
            attachments: []
        };
        _this.options = options || {
            keepCidLinks: false,
            downloadAttachments: false
        };
        _this._buffer = new Buffer('');
        _this._parser = new _mailparser.MailParser(options);
        _this._parser.on('headers', function (headers) {
            _this.mail.headers = headers;
        });
        _this._parser.on('data', function (data) {
            if (data.type === 'text') {
                Object.keys(data).forEach(function (key) {
                    if (['text', 'html', 'textAsHtml'].includes(key)) {
                        _this.mail[key] = data[key];
                    }
                });
            }
            if (data.type === 'attachment') {
                if (_this.options.downloadAttachments) {
                    _this.mail.attachments.push(data);
                    _this.emit('attachment', data);
                }

                var chunklen = 0;
                var chunks = [];

                data.content.on('readable', function () {
                    var chunk = void 0;
                    while ((chunk = data.content.read()) !== null) {
                        chunklen += chunk.length;
                        chunks.push(chunk);
                    }
                });
                data.content.on('end', function () {
                    data.content = Buffer.concat(chunks, chunklen);
                    data.release();
                });
            }
        });
        _this._parser.on('end', function () {
            ['subject', 'references', 'date', 'to', 'from', 'to', 'cc', 'bcc', 'message-id', 'in-reply-to', 'reply-to'].forEach(function (key) {
                if (_this.mail.headers.has(key)) _this.mail[key.replace(/-([a-z])/g, function (m, c) {
                    return c.toUpperCase();
                })] = _this.mail.headers.get(key);
            });

            _this.mail.eml = _this._buffer.toString('utf-8');

            if (_this.options.keepCidLinks) {
                _this.emit('result', _this.mail);
                return _this.end();
            }

            _this._parser.updateImageLinks(function (attachment, done) {
                return done(false, 'data:' + attachment.contentType + ';base64,' + attachment.content.toString('base64'));
            }, function (err, html) {
                if (err) {
                    _this.emit('result', _this.mail);
                    _this.emit('error', err);
                    return _this.end();
                }
                _this.mail.html = html;
                _this.emit('result', _this.mail);
                _this.end();
            });
        });
        _this.pipe(_this._parser);
        return _this;
    }

    _createClass(EMLStream, [{
        key: '_transform',
        value: function _transform(chunk, encoding, done) {
            this._buffer = Buffer.concat([this._buffer, chunk]);
            this.push(chunk);
            return done();
        }
    }]);

    return EMLStream;
}(_stream.Transform);

exports.default = EMLStream;
//# sourceMappingURL=stream.js.map