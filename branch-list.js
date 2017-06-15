#!/usr/bin/env node

var _         = require('lodash');
var fs        = require('fs');
var program   = require('commander');
var pkgInfo   = require('pkginfo')(module);
var Options   = require('options');
var async     = require('async');
var svn       = require('node-svn-ultimate');
var printf    = require('printf');
var Promise   = require('promise');


var opts = null;
var config = null;
var startTime = null;
var endTime = null;
var allProjects = [];

/**
 * Control flow is managed via async.waterfall() so methods are processed in series.
 * Provides the entry point to our program. It orchestrates the bootstrapping
 * of program info, validating arguments, loading options, and processing requests.
 *
 */
async.waterfall([

    setupProgramInfo,
    displayHeader,
    validateProgram,
    setupConfigOptions,    
    processRequest

], function (err) {
    if (err) processError(err);
});

/**
 * Utility function for displaying an error back to the user and terminating execution.
 */
function processError (err) {
    console.log();
    console.log('Error: ' + err.message);
    console.log();
    process.exit();
}

/**
 * Establishes program usage information through command line configuration options. Sets --version based
 * on package.json version setting.
 */
function setupProgramInfo (callback) {
    program
        .version(module.exports.version)
        .arguments('<branch>')
        .description('List all projects in repository containing target branch.')
        .parse(process.argv);

    callback();
}

/**
 * Utility function to display custom header in console.
 */
function displayHeader (callback) {
    //  Display header unless help or version information requested.
    if (!_.includes(process.argv, '-h') ||
        !_.includes(process.argv, '--help') ||
        !_.includes(process.argv, '-V') ||
        !_.includes(process.argv, '--version')) {

        // let's clear the screen.
        process.stdout.write('\033c');

        // Display header.
        console.log('****************************************');
        console.log('*                                      *');
        console.log('*            DevToolz v' + module.exports.version + '           *');
        console.log('*                                      *');
        console.log('****************************************');
        console.log();
        console.log();
        console.log('utility: branch-list');
        console.log();
        console.log();
        console.log();
    }

    callback();
}

/**
 * Validates the command line arguments, ensuring arguments are present, not in conflict
 * with one another, and config.json can be located.
 */
function validateProgram (callback) {
    var isValid = true;
    var errMsg = '';

    // Arguments must be set.
    if (program.args.length === 0) {
        isValid = false;
        errMsg = 'No arguments defined.';
    }

    // If already invalid, return error.
    if (!isValid) return callback(new Error(errMsg));

    // Set program level branch based on args. Supporting backwards compatibility.
    program.branch = program.args[0];

    // Set config path based on defined or default setting.
    var configPath = program.config ? program.config : 'config.json';

    // Check for config.json at set path.
    fs.access(configPath, fs.R_OK, function (err) {
        if (err) {
            return callback(new Error('Cannot locate --config value: ' + program.config));
        }

        callback(null, configPath);
    });
}

/**
 * Sets up configuration options based on config.json.
 */
function setupConfigOptions (configPath, callback) {
    // Setup default options.
    var defaultOptions = {
        svnRepos: null
    };
    opts = new Options(defaultOptions);
    config = opts.value;

    // Read config.json in defined path.
    opts.read(configPath, function (err) {
        if (err) return callback(err);       

        callback();
    });
}

/**
 * Generates list of all projects with branches
 */
function getProjects(callback) {
    console.log('Generating list of all projects...');
    console.log(); 

    startTime = new Date();               
    svn.commands.list(config.svnRepos, function(err, projects) {
        if (err) return callback(err);        
        var promises = projects.list.entry.map(function(p, pi, ap) {
            return new Promise(function(resolve, reject) {
                svn.commands.list(config.svnRepos + p.name + '/', function(err, folders) {
                    if (err) reject(err);                 
                    if (_.find(folders.list.entry, _.matchesProperty('name', 'branches')) != undefined) {
                        resolve(p.name);
                    }                
                    else resolve('nobranch');                
                });                        
            });
        });         
        Promise.all(promises).then(function(branches) {
            allProjects = _.filter(branches, function(b) {
                return b != 'nobranch';
            });
            callback();
        });
    });
    
}

/**
 * Grab list of projects, then process projects, checking for branches matching the name of the branch argument 
 */
function processRequest (callback) {
    getProjects(function(err) {
        if (err) return callback(err);
        processBranches(program.branch, function (err) {
            if (err) return callback(err);

            endTime = new Date();

            console.log();
            console.log();
            displayProcessTime();
            console.log();
            console.log();

            callback();
        });
    });
}

/**
 * Generating and outputting list of projects with branches matching branch argument.
 */
function processBranches (branch, callback) {
    console.log('Filtering list to projects containing a ' + branch + ' branch...');
    console.log(); 

    async.map(allProjects, processProject, function (err, results) {
        if (err) return callback(err);

        console.log();
        console.log();
        console.log('Project');
        console.log('-------------------------------');

        _.forEach(results, function (result, ri, allResults) {
            if (result.project != 'nobranch') {
                console.log(printf('%s', result.project));
            }            
        });

        console.log();
        console.log();

        callback();
    });        
         
}

/**
 * Process each project. 
 */
function processProject (project, callback) {    
    var projectBranchesUri = config.svnRepos + project + '/branches/';    
    // console.log(branchUri);
    // console.log(trunkUri);
    // console.log();    

    svn.commands.list(projectBranchesUri, function(err, branches) {
        if (err) return callback(err);
        if (_.find(branches.list.entry, _.matchesProperty('name', program.branch)) != undefined) {
            callback(null, {project: project});
        }
        else callback(null, {project: 'nobranch'});                
        
    });    
}

/**
 * Utility function to display how long the requested process took to complete.
 */
function displayProcessTime () {
    var timeDiff = endTime - startTime;
    timeDiff /= 1000;
    var seconds = Math.round(timeDiff % 60);
    timeDiff = Math.floor(timeDiff / 60);
    var minutes = Math.round(timeDiff % 60);

    console.log('Merge status check complete in ' + minutes + ' minutes and ' + seconds + ' seconds.');
}
