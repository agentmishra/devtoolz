var _         = require('lodash');
var fs        = require('fs');
var program   = require('commander');
var pkgInfo   = require('pkginfo')(module);
var Options   = require('options');
var async     = require('async');
var svn       = require('node-svn-ultimate');
var printf    = require('printf');


var opts = null;
var config = null;
var startTime = null;
var endTime = null;
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
        .description('Perform a merge status on target branch for configured projects.')
        .option('-c, --config <file>', 'path to configuration file - default path is current directory')
        .option('-l, --log <number of commits>', 'number of TRUNK log commits to include - default is 1,000')
        .option('-a, --author <name of author>', 'filters results by author name')
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
        console.log('utility: merge-status');
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
        svnRepos: null,
        mergeConfig: null,
        mergeProjects: [],
        mergeBranchGroups: []
    };
    opts = new Options(defaultOptions);
    config = opts.value;

    // Read config.json in defined path.
    opts.read(configPath, function (err) {
        if (err) return callback(err);

        // Check for valid mergeConfig.
        if (program.branch && (!opts.isDefinedAndNonNull('mergeConfig'))) {
            return callback(new Error('Using option --branch but no "mergeConfig" configuration defined.'));
        }

        callback();
    });
}

function processRequest (callback) {
    if (program.branch) {
        // Let's first make sure the target merge branch group is configured.
        validateTargetBranchGroup(program.branch, function (err, branchGroup) {
            if (err) return callback(err);

            startTime = new Date();

            console.log();
            processBranchGroup(branchGroup, function (err) {
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
}

/**
 * Validate target merge branch group is configured via config.json.
 */
function validateTargetBranchGroup (target, callback) {
    var targetBranchGroup = _.find(config.mergeBranchGroups, _.matchesProperty('name', target));

    if (typeof targetBranchGroup === 'undefined') {
        return callback(new Error('Merge branch group ' + target + ' is not configured.'));
    }

    callback(null, targetBranchGroup);
}

/**
 * Process each target merge branch group.
 */
function processBranchGroup (branchGroup, callback) {
    var targetProjects = [];

    console.log('Checking merge status on branch ' + branchGroup.name + ' back to TRUNK...');
    console.log();

    if (program.author) {
        console.log('Filtering by author: ' + program.author);
        console.log();
    }

    _.forEach(branchGroup.projects, function (project, pi, allProjects) {
        var targetProject = _.find(config.mergeProjects, _.matchesProperty('name', project));

        if (typeof targetProject === 'undefined') {
            return callback(new Error('Merge project ' + project + ' is not configured.'));
        }

        targetProjects.push(targetProject);
    });

    async.map(targetProjects, processProject, function (err, results) {
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
}

/**
 * Process each target project. Check project TRUNK for any MERGE commits from target branch.
 * Check if there are any pending commits that need to be merged to TRUNK from target branch.
 */
function processProject (project, callback) {
    var branchMergeRevision = null;
    var mc = config.mergeConfig;
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
