# devtoolz
A collection of command line utilities to assist developers with repetitive tasks.

## Getting Started
The first thing you will need to do to get started with devtoolz is to install it on your machine. This can be accomplished by downloading the package and installing manually or using npm package manager. Using the npm package manager is the preferred method of installation.

### Installing Manually
Manual installation is fairly straight forward. The following steps should get you setup.
1. Download the latest tagged release [here](https://github.com/griffiti/devtoolz/releases).
2. Uncompress the downloaded zip|tar file.
3. Using a terminal or command prompt, go into the uncompressed directly. For example, if you downloaded tag 1.2.5, then you will see a folder called ```.\devtoolz-1.2.5```.
4. Install the depended npm packages by running ```npm install```.
5. Finally, install devtoolz itself globally so the commands are available from anywhere on your machine.

### Package Installation
1. Using a terminal or command prompt, run the following command:
```
npm install -g devtoolz
```

### Config File Location
Devtoolz relies heavily on the ```config.json``` file. If you installed devtoolz manually, you will find a sample file in your installation folder. If you installed via npm pakcage manager, youl will need to create a ```config.json``` file.

When you run a command, devtoolz looks to your current folder for a ```config.json``` file. If it cannot find one in your current folder, it will throw an error. Optionally, you can provide a path to your config file.

**Optional config file path paramter**
```
--config /path/to/config.json
```

Probably the most convenient location is to place your ```config.json``` file in your home directory or an easily accessible one. If your terminal always starts off in your home directory, place the file there. If your command prompt always launches at C:\ then place it there. This way when you open up a terminal or command prompt, it is accessible. And if you are in some other location, an easy reference looks like this:

```
--config ~/config.json
```

### Config File Setup
The first setting you need to configure is the ```svnRepos``` value which should point to your SVN repository. Other config sections are specific to certain commands.
