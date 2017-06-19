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
var mergePattern = "^MERGE (\\d+)(-(\\d+))?";

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
        console.log('utility: master-merge-status');
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
        var targetProjects = [];        
        _.forEach(results, function (result, ri, allResults) {
            if (result.project != 'nobranch') {
                switch (result.project) {
                    case 'EntityModels':
                        targetProjects.push({
                            projectUri: result.project + '/',
                            trunkUri: 'Trunk/'
                        });                
                    break;
                    case 'CPSIntegration': 
                        targetProjects.push({
                            projectUri: result.project + '/',
                            trunkUri: 'Trunk/CPSIntegration/'
                        });                
                    break;
                    default:
                        targetProjects.push({
                            projectUri: result.project + '/'
                        });                
                    break;
                }
            }            
        });   
        console.log('Checking merge status on branch ' + program.branch + ' back to TRUNK...');
        console.log();
        async.map(targetProjects, checkProjectMergeStatus, function (err, results) {
            if (err) return callback(err);

            console.log();
            console.log();
            console.log('Status   Commits  Project');
            console.log('-------  -------  -------------------------------');

            _.forEach(results, function (result, ri, allResults) {
                console.log(printf('%7s  %7d  %s', result.status, result.commits, result.project));
            });

            console.log();
            console.log();

            callback();
        });                     
    });        
         
}

function checkProjectMergeStatus (project, callback) {
    var branchMergeRevision = null;    
    var mc = {
        trunkUri: "trunk/",
        branchesUri: "branches/",
        logLimit: 1000
    };
    var branchUri = config.svnRepos + project.projectUri + mc.branchesUri + program.branch;
    var trunkUri = config.svnRepos + project.projectUri + (project.trunkUri ? project.trunkUri : mc.trunkUri);
    var logLimit = '--limit ' + (program.log ? program.log : mc.logLimit);
    // console.log(branchUri);
    // console.log(trunkUri);
    // console.log();

    svn.commands.log(trunkUri, {quiet: false, force: true, params: [logLimit]}, function (err, msg) {
        if (err) return callback(err);

        var trunkMerge = _.find(msg.logentry, function(o) {
            var testPattern = "^MERGE.*" + program.branch;
            var regExp = new RegExp(testPattern, "g");

            return regExp.test(o.msg);
        });

        if (typeof trunkMerge !== 'undefined') {
            // Let's parse out the last branch revision merged.
            var regExp = new RegExp(mergePattern, "g");
            var matches = regExp.exec(trunkMerge.msg);
            branchMergeRevision = (matches.length > 2 && typeof matches[3] !== 'undefined') ? parseInt(matches[3]) : parseInt(matches[1]);
        }

        svn.commands.log(branchUri, {quiet: false, force: true, params: ['--stop-on-copy']}, function (err, msg) {
            if (err) return callback(err);

            if (msg.logentry === null) return callback(new Error('SVN path not found for ' + branchUri));

            // First, let's normalize logs so we're always dealing with an array.
            var logs = Array.isArray(msg.logentry) ? msg.logentry : [msg.logentry];
            // console.log('Project: ' + project.projectUri.replace('/', ''));
            // console.log('Total logs: ' + logs.length);

            // Next, let's filter out commits related to branch creation.
            var filteredLogs = _.filter(logs, function (log) {
                return (!log.msg.includes('Created release branch') &&
                        !log.msg.includes('Created feature branch') &&
                        !log.msg.includes('Created DataConfig') &&
                        !log.msg.includes('Created Functions') &&
                        !log.msg.includes('Created StoredProcs') &&
                        !log.msg.includes('Created Tables') &&
                        !log.msg.includes('Created Views') &&
                        !log.msg.includes('Created ClientSettings') &&
                        !log.msg.includes('Initial setup') &&
                        !log.msg.includes('Updated svn:externals') &&
                        !log.msg.includes('Updated project file') &&
                        !log.msg.includes('Updated version information') &&
                        !log.msg.includes('MERGE'));
            });
            // console.log(project.projectUri.replace('/', ''));
            // console.log(filteredLogs);
            // console.log();
            // console.log('Total filtered logs: ' + filteredLogs.length);
            // console.log('-------------------------------------');
            // console.log();
            // callback(null, {status: '', commits: 0, project: project.projectUri.replace('/', '')});
            // return;

            var isBranchOutstanding = false;

            // If author option is set, filter logs by author.
            if (program.author) {
                filteredLogs = _.filter(filteredLogs, function (log) {
                    return (log.author === program.author);
                });
            }

            // var totalCommits = Array.isArray(msg.logentry) ? msg.logentry.length : 1;
            var totalCommits = filteredLogs.length;

            if ((typeof trunkMerge === 'undefined') && totalCommits >= 1) {
                isBranchOutstanding = true;
            } else if (typeof trunkMerge !== 'undefined') {
                if (totalCommits > 0) {
                    var currentRevision = parseInt(filteredLogs[0].$.revision);
                    if (currentRevision > branchMergeRevision) {
                        isBranchOutstanding = true;
                    }
                }
            }

            var status = isBranchOutstanding ? 'PENDING' : (totalCommits === 0 ? '' : 'MERGED');
            callback(null, {status: status, commits: totalCommits, project: project.projectUri.replace('/', '')});
        });
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
