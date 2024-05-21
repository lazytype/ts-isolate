import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts, {
    type LanguageService,
    type LanguageServiceHost,
    type ParseConfigFileHost,
    type TextChange,
} from 'typescript';

export async function codefixProject({
    tsconfig,
    files,
    write,
}: {
    tsconfig: string;
    files: Iterable<string> | null;
    write: boolean;
}): Promise<void> {
    if (files) {
        const {validFiles, invalidFiles} = await validateFiles(files);
        if (invalidFiles.size > 0) {
            console.error('\nThe following file paths are invalid:');
            invalidFiles.forEach((file) => console.error(file));
        }
        files = validFiles;
    }

    console.log('Starting...');
    const languageService = createLanguageService(tsconfig);
    const program = languageService.getProgram();
    assert(program);

    const promises = [];
    for (const {fileName, textChanges} of genCodeFixesFromProject(
        languageService,
        files
            ? new Set([...files].map((file) => path.relative(program.getCurrentDirectory(), file)))
            : null,
    )) {
        promises.push(
            (async () => {
                console.log('Applying fixes to file: ' + fileName);
                const sourceFile = program.getSourceFile(fileName);
                if (sourceFile === undefined) {
                    throw new Error(`File ${fileName} not found in project`);
                }
                const updatedText = applyTextChanges(sourceFile.text, textChanges);

                if (write) {
                    await fs.writeFile(fileName, updatedText, {encoding: 'utf8'});
                    console.log('Updated ' + fileName);
                } else {
                    console.log('Not writing changes to ' + fileName);
                }
            })(),
        );
    }

    await Promise.all(promises);
}

async function validateFiles(files: Iterable<string>): Promise<{
    validFiles: Set<string>;
    invalidFiles: Set<string>;
}> {
    const results = await Promise.allSettled(
        [...files].map(async (file) => {
            await fs.access(file);
            return file;
        }),
    );

    const validFiles = new Set(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    );

    if (validFiles.size === 0) {
        throw new Error('All provided files are invalid');
    }

    const invalidFiles = new Set<string>();
    for (const file of files) {
        if (!validFiles.has(file)) {
            invalidFiles.add(file);
        }
    }

    return {validFiles, invalidFiles};
}

function* genCodeFixesFromProject(
    service: LanguageService,
    files: ReadonlySet<string> | null,
): Generator<{fileName: string; textChanges: ReadonlyArray<TextChange>}> {
    const program = service.getProgram();
    assert(program);

    for (const file of program.getSourceFiles()) {
        if (/[\\/]node_modules[\\/]/.test(file.fileName)) {
            continue;
        }

        if (file.isDeclarationFile) {
            continue;
        }

        const relativePath = path.relative(program.getCurrentDirectory(), file.fileName);
        console.log(files, relativePath)
        if (files !== null && !files.has(relativePath)) {
            continue;
        }

        console.log('Getting codefixes for ' + relativePath);

        const codefix = service.getCombinedCodeFix(
            {
                type: 'file',
                fileName: relativePath,
            },
            'fixMissingTypeAnnotationOnExports',
            {},
            {
                allowRenameOfImportPath: false,
                includeCompletionsForImportStatements: true,
            },
        );

        if (codefix.changes.length === 0) {
            continue;
        }

        if (codefix.changes.length > 1) {
            assert.fail('Multiple fixes found for ' + relativePath);
        }

        yield {fileName: relativePath, textChanges: codefix.changes[0]!.textChanges};
    }
}

const dynamicTypeRegex = /\bimport\("([^"]+)"\)\.([A-Za-z0-9_]+)\b/g;

function applyTextChanges(
    fileText: string,
    textChanges: ReadonlyArray<TextChange>,
    fixupTypes = true,
): string {
    const importsToAddByModule = new Map<string, Set<string>>();

    for (let i = textChanges.length - 1; i >= 0; i--) {
        const {
            span: {start, length},
            newText,
        } = textChanges[i]!;
        const end = start + length;

        let updatedText = newText;

        if (fixupTypes) {
            const oldText = fileText.substring(start, end);
            if (!dynamicTypeRegex.test(oldText)) {
                const changes = [];

                for (const match of newText.matchAll(dynamicTypeRegex)) {
                    const [matchText, module, type] = match;
                    assert(module && type);
                    if (!importsToAddByModule.has(module)) {
                        importsToAddByModule.set(module, new Set());
                    }
                    importsToAddByModule.get(module)!.add(type);

                    changes.push({
                        span: {start: match.index, length: matchText.length},
                        newText: type,
                    });
                }

                updatedText = applyTextChanges(newText, changes, false);
            }
        }

        fileText = `${fileText.substring(0, start)}${updatedText}${fileText.substring(end)}`;
    }

    if (fixupTypes) {
        fileText = fileText.replace(/import \{( type)? JSX \} from 'react\/jsx-runtime';\n/g, '');
    }

    if (importsToAddByModule.size > 0) {
        const sourceFile = ts.createSourceFile('_.tsx', fileText, ts.ScriptTarget.Latest, true);
        const importStatements = sourceFile.statements.filter(
            (statement) => statement.kind === ts.SyntaxKind.ImportDeclaration,
        );
        const lastImportStatement = importStatements.at(-1);
        assert(lastImportStatement);
        const insertionPosition = lastImportStatement.end;

        fileText = `${fileText.substring(0, insertionPosition)}\n${[...importsToAddByModule]
            .map(([module, types]) => `import {${[...types].join(', ')}} from '${module}';`)
            .join('\n')}${fileText.substring(insertionPosition)}`;
    }

    return fileText;
}

function createLanguageService(tsConfigFilePath: string): LanguageService {
    const readFile = ts.sys.readFile;

    const parseConfigHost: ParseConfigFileHost = {
        fileExists: ts.sys.fileExists,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        readDirectory: ts.sys.readDirectory,
        readFile,
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            const message = ts.formatDiagnosticsWithColorAndContext([diagnostic], {
                getCanonicalFileName: (fileName) => fileName,
                getCurrentDirectory: ts.sys.getCurrentDirectory,
                getNewLine: () => ts.sys.newLine,
            });
            throw new Error(message);
        },
    };

    const commandLine = ts.getParsedCommandLineOfConfigFile(
        path.resolve(tsConfigFilePath),
        undefined,
        parseConfigHost,
    );
    assert(commandLine);

    const languageServiceHost: LanguageServiceHost = {
        getCompilationSettings: () => commandLine.options,
        getProjectReferences: () => commandLine.projectReferences,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getDefaultLibFileName: (compilerOptions) =>
            path.join(
                path.dirname(ts.sys.getExecutingFilePath()),
                ts.getDefaultLibFileName(compilerOptions),
            ),
        fileExists: ts.sys.fileExists,
        readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
        getScriptFileNames: () => commandLine.fileNames,
        getScriptVersion: () => '0',
        getScriptSnapshot: (fileName) => {
            const fileContents = readFile(fileName);
            if (fileContents === undefined) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(fileContents);
        },
    };

    return ts.createLanguageService(languageServiceHost);
}
