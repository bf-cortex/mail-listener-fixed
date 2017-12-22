'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

var _stream = require('./stream');

var _stream2 = _interopRequireDefault(_stream);

var _imap = require('imap');

var _imap2 = _interopRequireDefault(_imap);

var _lodash = require('lodash');

var _fs = require('fs');

var _path = require('path');

var path = _interopRequireWildcard(_path);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var debug = require('debug')('imap:listener');

var MailListener = function (_EventEmitter) {
    _inherits(MailListener, _EventEmitter);

    _createClass(MailListener, null, [{
        key: 'formatDate',
        value: function formatDate(date) {
            if (!date) date = new Date(0);
            return date.toISOString().split('T')[0];
        }
    }]);

    function MailListener(options) {
        _classCallCheck(this, MailListener);

        var _this = _possibleConstructorReturn(this, (MailListener.__proto__ || Object.getPrototypeOf(MailListener)).call(this));

        _this.retry = 0;
        _this.lastUID = 0;
        _this.busy = false;
        _this.forceStop = false;
        _this.haveNewEmails = false;
        _this.defaultOptions = {
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
        _this.options = (0, _lodash.defaultsDeep)(options, _this.defaultOptions);
        _this.options.filter = typeof _this.options.filter === 'string' ? [_this.options.filter] : _this.options.filter;
        _this.options.parserOptions.streamAttachments = _this.options.parserOptions.downloadAttachments && _this.options.attachmentOptions.stream;
        _this.imap = new _imap2.default(_this.options.imapOptions);
        _this.imap.on('error', _this.onError.bind(_this));
        _this.imap.on('close', _this.onClose.bind(_this));
        _this.imap.on('ready', _this.onReady.bind(_this));
        _this.lastFetch = _this.options.fetchFromNow;
        return _this;
    }

    _createClass(MailListener, [{
        key: 'onError',
        value: function onError(err) {
            this.emit('error', err);
        }
    }, {
        key: 'onClose',
        value: function onClose() {
            var _this2 = this;

            if (!this.forceStop && this.retry < this.options.imapOptions.maxRetry) {
                setTimeout(function () {
                    debug("Trying to establish imap connection again...");
                    _this2.start();
                }, this.options.imapOptions.retryDelay);
                return this.retry++;
            }
            this.emit('disconnected');debug('disconnected');
            this.forceStop = false;
            this.retry = 0;
        }
    }, {
        key: 'onReady',
        value: function onReady() {
            var _this3 = this;

            this.imap.openBox(this.options.mailbox, false, function (err, box) {
                if (err) return _this3.onError(err);
                _this3.lastUID = box.uidnext - 1;
                _this3.emit('connected');debug('connected');
                if (_this3.options.fetchOnStart) _this3.search();
                _this3.imap.on('mail', _this3.onMail.bind(_this3));
                _this3.imap.on('update', _this3.onMail.bind(_this3));
                _this3.retry = 0;
            });
        }
    }, {
        key: 'onMail',
        value: function onMail() {
            if (!this.haveNewEmails && !this.busy) {
                this.busy = true;
                this.search();
            } else if (this.busy) this.haveNewEmails = true;
        }
    }, {
        key: 'search',
        value: function search() {
            var _this4 = this;

            var filter = this.options.filter.slice();
            if (this.lastFetch === true) this.lastFetch = new Date();
            if (this.options.setSince) filter.push(["SINCE", MailListener.formatDate(this.lastFetch)]);
            this.imap.search(filter, function (err, results) {
                results = results.filter(function (x) {
                    return x > _this4.lastUID;
                });
                if (err) return _this4.onError(err);
                _this4.lastFetch = new Date();
                if (results.length > 0) {
                    if (_this4.options.setFlags) {
                        _this4.imap.setFlags(results, ['\\Seen'], function (err) {
                            if (err) _this4.onError(err);
                        });
                    }
                    var fetch = _this4.imap.fetch(results, {
                        markSeen: _this4.options.markSeen,
                        bodies: ''
                    });
                    fetch.on('message', function (msg, seg) {
                        var attributes = {};
                        msg.once('attributes', function (attr) {
                            attributes = attr;
                        });
                        msg.once('body', function (stream) {
                            var emlStream = new _stream2.default(_this4.options.parserOptions);
                            emlStream.on('attachment', function (attachment) {
                                if (!_this4.options.parserOptions.streamAttachments && _this4.options.parserOptions.downloadAttachments && attachment) {
                                    (0, _fs.writeFile)(_this4.options.attachmentOptions.directory + attachment.generatedFileName, attachment.content, function (err) {
                                        if (!err) {
                                            attachment.path = path.resolve(_this4.options.attachmentOptions.directory + attachment.generatedFileName);
                                            _this4.emit('attachment', attachment);
                                            return;
                                        }
                                        _this4.onError(err);
                                    });
                                }
                            });
                            emlStream.on('result', function (mail) {
                                if (attributes && attributes.uid && attributes.uid > _this4.lastUID) {
                                    _this4.lastUID = attributes.uid;
                                }
                                _this4.emit('mail', mail, seg, attributes);
                            });
                            emlStream.on('error', function (err) {
                                _this4.onError(err);
                            });
                            stream.pipe(emlStream);
                        });
                    });
                    fetch.once('error', function (err) {
                        _this4.onError(err);
                    });
                    fetch.once('end', function () {
                        debug('all processed');
                        if (_this4.haveNewEmails) {
                            _this4.haveNewEmails = false;
                            return _this4.search();
                        }
                        _this4.busy = false;
                    });
                    return;
                }
                if (_this4.haveNewEmails) {
                    _this4.haveNewEmails = false;
                    return _this4.search();
                }
                _this4.busy = false;
            });
        }
    }, {
        key: 'start',
        value: function start() {
            debug('detaching existing listener');
            this.imap.removeAllListeners('update');
            this.imap.removeAllListeners('mail');

            debug('calling imap connect');
            this.imap.connect();
        }
    }, {
        key: 'stop',
        value: function stop() {
            this.forceStop = true;
            this.imap.end();
        }
    }]);

    return MailListener;
}(_events2.default);

exports.default = MailListener;
//# sourceMappingURL=index.js.map