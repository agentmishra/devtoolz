#!/usr/local/bin/node --harmony

var _         = require('lodash');
var fs        = require('fs');
var program   = require('commander');
var pkgInfo   = require('pkginfo')(module);
var Options   = require('options');

program
    .version(module.exports.version)
    .option('-c, --config <file>', 'path to configuration file - default path is current directory');

program
    .command('refresh <project|workspace>')
    .description('Perform a merge status on target branch for configured projects.')
    .option('-b, --build', 'perform build for target project or workspace')
    .action(function(target, options) {
        console.log('target: ' + target);
        process.exit(0);
    });

program.parse(process.argv);