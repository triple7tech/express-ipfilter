/*!
 * Express - IP Filter
 * Copyright(c) 2014 Bradley and Montgomery Inc.
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 */
var _ = require('lodash');
var iputil = require('ip');
var rangeCheck = require('range_check');
var IpDeniedError = require('./deniedError');

var persistent = {
  ips: [],
  add(ips) {
    this.ips = _.union(persistent.ips, ips);
  },
  remove(ips) {
    this.ips = _.difference(persistent.ips, ips);
  },
};

/**
 * express-ipfilter:
 *
 * IP Filtering middleware;
 *
 * Examples:
 *
 *      var ipfilter = require('ipfilter'),
 *          ips = ['127.0.0.1'];
 *
 *      app.use(ipfilter(ips));
 *
 * Options:
 *
 *  - `mode` whether to deny or grant access to the IPs provided. Defaults to 'deny'.
 *  - `logF` Function to use for logging.
 *  - `log` console log actions. Defaults to true.
 *  - `allowPrivateIPs` whether to allow private IPs.
 *  - `allowedHeaders` Array of headers to check for forwarded IPs.
 *  - 'excluding' routes that should be excluded from ip filtering
 *
 * @param [ips] {Array} IP addresses
 * @param [opts] {Object} options
 * @api public
 */
function ipfilter(ipsIn, opts) {
  persistent.add(ipsIn);

  var logger = function(message){ console.log(message);};
  var settings = _.defaults( opts || {}, {
    mode: 'deny',
    log: true,
    logF: logger,
    allowedHeaders: [],
    allowPrivateIPs: false,
    excluding: [],
    detectIp: getClientIp
  });

  function getClientIp(req) {
    var ipAddress;

    var headerIp = _.reduce(settings.allowedHeaders, function(acc, header){
      var testIp = req.headers[header];
      if(testIp != ''){
        acc = testIp;
      }

      return acc;
    },'');

    if(headerIp) {
      var splitHeaderIp = headerIp.split(',');
      ipAddress = splitHeaderIp[0];
    }

    if(!ipAddress) {
      ipAddress = req.connection.remoteAddress;
    }

    if(!ipAddress){
      return '';
    }

    if(iputil.isV6Format(ipAddress) && ~ipAddress.indexOf('::ffff')){
      ipAddress = ipAddress.split('::ffff:')[1];
    }

    if(iputil.isV4Format(ipAddress) && ~ipAddress.indexOf(':')){
      ipAddress = ipAddress.split(':')[0];
    }

    return ipAddress;
  }

  var matchClientIp = function(ip){
    var mode = settings.mode.toLowerCase();

    var result = _.invoke(persistent.ips,testIp,ip,mode);

    if(mode === 'allow'){
      return _.some(result);
    }else{
      return _.every(result);
    }
  };

  var testIp = function(ip,mode){
    var constraint = this;

    // Check if it is an array or a string
    if(typeof constraint === 'string'){
      if(rangeCheck.validRange(constraint)){
        return testCidrBlock(ip,constraint,mode);
      }else{
        return testExplicitIp(ip,constraint,mode);
      }
    }

    if(typeof constraint === 'object'){
      return testRange(ip,constraint,mode);
    }
  };

  var testExplicitIp = function(ip,constraint,mode){
    if(ip === constraint){
      return mode === 'allow';
    }else{
      return mode === 'deny';
    }
  };

  var testCidrBlock = function(ip,constraint,mode){
    if(rangeCheck.inRange(ip, constraint)){
      return mode === 'allow';
    }else{
      return mode === 'deny';
    }
  };

  var testRange = function(ip,constraint,mode){
    var filteredSet = _.filter(persistent.ips,function(constraint){
      if(constraint.length > 1){
        var startIp = iputil.toLong(constraint[0]);
        var endIp = iputil.toLong(constraint[1]);
        var longIp = iputil.toLong(ip);
        return  longIp >= startIp && longIp <= endIp;
      }else{
        return ip === constraint[0];
      }
    });

    if(filteredSet.length > 0){
      return mode === 'allow';
    }else{
      return mode === 'deny';
    }
  };

  return function(req, res, next) {
    if(settings.excluding.length > 0){
      var results = _.filter(settings.excluding,function(exclude){
        var regex = new RegExp(exclude);
        return regex.test(req.url);
      });

      if(results.length > 0){
        if(settings.log && settings.logLevel !== 'deny'){
          settings.logF('Access granted for excluded path: ' + results[0]);
        }
        return next();
      }
    }

    var ip = settings.detectIp(req);
    // If no IPs were specified, skip
    // this middleware
    //if(!persistent.ips || !persistent.ips.length) { return next(); }

    if(matchClientIp(ip,req)) {
      // Grant access
      if(settings.log && settings.logLevel !== 'deny') {
        settings.logF('Access granted to IP address: ' + ip);
      }

      return next();
    }

    // Deny access
    if(settings.log && settings.logLevel !== 'allow') {
      settings.logF('Access denied to IP address: ' + ip);
    }

    var err = new IpDeniedError('Access denied to IP address: ' + ip);
    return next(err);
  };
}

_.merge(ipfilter, persistent);

module.exports = ipfilter;
