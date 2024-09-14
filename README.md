# ts-isolate

> :warning: Usage of the tool has only been exercised on MacOS

This tool assumes that you have a TypeScript project with isolatedDeclarations enabled. It will attempt to resolve errors due to isolatedDeclarations by applying autofixes provided by the TypeScript compiler. These are the same autofixes that would be applied when using Quick Fixes in Visual Studio Code. If you wish to use a more recent version of TypeScript, you can clone and build the tool yourself, or open a pull request to bump the TypeScript version.

# Installation

The simplest way to install the tool is to use a JavaScript package manager to globally install it, e.g.
```sh
npm install -g ts-isolate
```

This will typically add the tool to your terminal's path, assuming a UNIX-like environment.

# Running

```sh
# Performs a dry-run
ts-isolate -p <path_to_tsconfig_json_file>

# Actually apply the autofixes
ts-isolate -p <path_to_tsconfig_json_file> --write

# Only apply autofixes to specific files
ts-isolate -p <path_to_tsconfig_json_file> --write --file <path_to_ts_file_1> --file <path_to_ts_file_2>
```

Things to note:
- There may sometimes be multiple eligible autofixes for a given isolatedDeclarations error. This tool chooses an arbitrary one in each case.
- The formatting of the applied code changes will likely be ugly, so have your favorite code formatter on-hand.

# Building locally

Clone the repo and install its dependencies. Use your package manager's command that runs the package's `prepublishOnly` script, e.g.

```sh
git clone https://github.com/lazytype/ts-isolate.git
cd ts-isolate
pnpm install
pnpm prepublishOnly
```

Run `./bin/ts-isolate.js` as you would the installed CLI version.
