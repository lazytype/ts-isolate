import {Command, Option, runExit} from 'clipanion';

import {codefixProject} from './ts_isolate.js';

class TsAnnotateCommand extends Command {
    public tsconfig = Option.String('-p', {
        description: "Path to project's tsconfig",
        required: true,
    });

    public file = Option.Array('--file', {
        description: 'Files to transpile',
    });

    public write = Option.Boolean('--write', {
        description: 'Tool will only emit or overwrite files if --write is included.',
        required: false,
    });

    public async execute() {
        await codefixProject({
            files: this.file ?? null,
            tsconfig: this.tsconfig,
            write: this.write ?? false,
        });
    }
}

runExit({binaryName: 'ts_isolate'}, TsAnnotateCommand);
