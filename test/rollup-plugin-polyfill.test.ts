import path from "path/posix"
import { rollup, RollupBuild, OutputChunk, Plugin } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import polyfill from '../src/index';

it('injects a polyfill', async () => {
    const bundle = await rollup({
        input: '/main.js',
        plugins: [
            loader({
                '/main.js': 'expect(global.polyfilled).toBe(true);',
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill'])
        ]
    });
    await executeBundle(bundle, 'main.js')
});

it('injects multiple polyfills in given order', async () => {
    const bundle = await rollup({
        input: '/main.js',
        plugins: [
            loader({
                '/main.js': 'expect(global.polyfill1).toBe(true); expect(global.polyfill2).toBe(true); expect(global.polyfill3).toBe(true); global.main = true;',
                polyfill1: 'global.polyfill1 = true;',
                polyfill2: 'expect(global.polyfill1).toBe(true); global.polyfill2 = true;',
                polyfill3: 'expect(global.polyfill2).toBe(true); global.polyfill3 = true;'
            }),
            polyfill(['polyfill1', 'polyfill2', 'polyfill3'])
        ]
    });
    expect((await executeBundle(bundle, 'main.js')).global).toEqual({
        main: true,
        polyfill1: true,
        polyfill2: true,
        polyfill3: true
    });
});

it('maintains entry signature', async () => {
    const bundle = await rollup({
        input: '/main.js',
        plugins: [
            loader({
                '/main.js': 'expect(global.polyfilled).toBe(true); export const foo = "foo"; export default "default";',
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill'])
        ]
    });
    expect((await executeBundle(bundle, 'main.js')).exports).toEqual({
        default: "default",
        foo: "foo"
    });
});

it('handles multiple entry points', async () => {
    const bundle = await rollup({
        input: ['/main.js', '/other.js'],
        plugins: [
            loader({
                '/main.js': 'import "./shared.js"; expect(global.polyfilled).toBe(true); global.main = true;',
                '/other.js': 'import "./shared.js"; expect(global.polyfilled).toBe(true); global.other = true;',
                '/shared.js': 'expect(global.polyfilled).toBe(true); global.shared = true;',
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill'])
        ]
    });
    expect((await executeBundle(bundle, 'main.js')).global).toEqual({
        polyfilled: true,
        main: true,
        shared: true
    });
    expect((await executeBundle(bundle, 'other.js')).global).toEqual({
        polyfilled: true,
        other: true,
        shared: true
    });
});

it('handles files promoted to entry points via this.emitFile', async () => {
    const bundle = await rollup({
        input: '/main.js',
        plugins: [
            loader({
                '/main.js': 'import "./other.js"; expect(global.polyfilled).toBe(true); global.main = true;',
                '/other.js': 'expect(global.polyfilled).toBe(true); global.other = true;',
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill']),
            {
                name: "otherJS",
                transform(code, id) {
                    if (id === '/other.js') {
                        this.emitFile({type: 'chunk', id: '/other.js', fileName: 'other.js'})
                    }

                    return { code };
                }
            }
        ]
    });
    expect((await executeBundle(bundle, 'main.js')).global).toEqual({
        polyfilled: true,
        main: true,
        other: true
    });
    expect((await executeBundle(bundle, 'other.js')).global).toEqual({
        polyfilled: true,
        other: true,
    });
});

it('works if a plugin preloads entry points via this.load', async () => {
    const bundle = await rollup({
        input: '/main.js',
        plugins: [
            {
                name: "resolve",
                async resolveId(source, importer, options) {
                    const resolved = await this.resolve(source, importer, {...options, skipSelf: true});
                    const info = await this.load(resolved);
                    
                    return { id: info.id }
                }
            },
            loader({
                '/main.js': 'expect(global.polyfilled).toBe(true);',
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill']),
        ]
    });
    await executeBundle(bundle, 'main.js');
});

it('fails with the proper error for external entry points', async () => {
    await expect(rollup({
        input: 'external',
        external: ['external'],
        plugins: [
            loader({
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill']),
        ]
    })).rejects.toEqual(new Error('Entry module cannot be external (external).'))
});

it('fails with the proper error for missing entry points', async () => {
    await expect(rollup({
        input: 'missing',
        plugins: [
            loader({
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill']),
        ]
    })).rejects.toEqual(new Error('Could not resolve entry module (missing).'))
});

it('ensures entry points and polyfill side effects are always respected', async () => {
    const bundle = await rollup({
        input: '/main.js',
        treeshake: {moduleSideEffects: false},
        plugins: [
            loader({
                '/main.js': 'global.main = true; expect(global.polyfilled).toBe(true);',
                polyfill: 'global.polyfilled = true;'
            }),
            polyfill(['polyfill']),
        ]
    });
    expect((await executeBundle(bundle, 'main.js')).global).toEqual({
        main: true,
        polyfilled: true
    });
});

it('throws a helpful error for unresolved polyfills', async () => {
    await expect(rollup({
        plugins: [
            polyfill(['unresolved']),
        ]
    })).rejects.toEqual(new Error('Could not resolve polyfill "unresolved". If you do not want to bundle your polyfills ' +
        'and just want to inject imports, please mark them as external by using Rollup\'s "external" option.'))
});

it('allows polyfills to be external', async () => {
    const bundle = await rollup({
        input: '/main.js',
        external: ['polyfill'],
        plugins: [
            loader({
                '/main.js': 'expect(global.polyfilled).toBe(true);',
            }),
            polyfill(['polyfill'])
        ]
    });
    expect(await getChunkMapFromBundle(bundle)).toEqual({
        'main.js': "'use strict';\n\nrequire('polyfill');\n\nexpect(global.polyfilled).toBe(true);\n"
    })
});

it('works with commonjs entry points', async () => {
    const bundle = await rollup({
        input: '/main.js',
        plugins: [
            loader({
                '/main.js': 'expect(global.polyfilled).toBe(true); exports.foo = require("./foo.js");',
                '/foo.js': 'module.exports = "foo";',
                polyfill: 'global.polyfilled = true;'
            }),
            // We need `ignoreGlobal` just because of our test setup
            commonjs({ignoreGlobal: true}),
            polyfill(['polyfill'])
        ]
    });
    expect((await executeBundle(bundle, 'main.js')).exports).toEqual({
        default: { foo: "foo" },
        foo: "foo"
    });
});

// A simple plugin to resolve and load some virtual files
function loader(modules: { [key: string]: string }): Plugin {
    return {
        name: 'loader',
        load(id) {
            if (Object.hasOwnProperty.call(modules, id)) {
                return modules[id];
            }
            return null;
        },
        resolveId(source, importer) {
            const id = source.startsWith('.') ? path.join(path.dirname(importer), source) : source;
            if (Object.hasOwnProperty.call(modules, id)) {
                return id;
            }
            return null;
        }
    };
}

// helpers to run tests with virtual files
function requireWithContext(code: string, context) {
    const module = {exports: {}};
    const contextWithExports = {...context, module, exports: module.exports};
    const contextKeys = Object.keys(contextWithExports);
    const contextValues = contextKeys.map((key) => contextWithExports[key]);
    try {
        const fn = new Function(contextKeys.toString(), code);
        fn.apply({}, contextValues);
    } catch (error) {
        if ((error as any).hasOwnProperty("exports"))
          (error as any).exports = module.exports;
        throw error;
    }
    return contextWithExports.module.exports;
}

function runCodeFromChunkMap(chunkMap: { [key: string]: string }, entry: string) {
    const requireFromOutputVia = (importer: string) => (source: string) => {
        const outputId = path.join(path.dirname(importer), source);
        const code = chunkMap[outputId];
        if (typeof code !== 'undefined') {
            return requireWithContext(
                code,
                {require: requireFromOutputVia(outputId), ...context}
            );
        }
        return require(source);
    };

    if (!chunkMap[entry]) {
        throw new Error(
            `Could not find entry "${entry}" in generated output.\nChunks:\n${Object.keys(
                chunkMap
            ).join('\n')}`
        );
    }
    const global = {};
    const context = {global}
    return {
        exports: requireWithContext(chunkMap[entry], {
            require: requireFromOutputVia('main.js'),
            ...context
        }),
        global
    };
}

async function executeBundle(bundle: RollupBuild, entry: string) {
    const chunkMap = await getChunkMapFromBundle(bundle);
    try {
        return runCodeFromChunkMap(chunkMap, entry);
    } catch (error) {
        if (error instanceof Error) {
          error.message += `\n\n${stringifyChunkMap(chunkMap)}`
        }
        throw error;
    }
}

async function getChunkMapFromBundle(bundle: RollupBuild) {
    const generated = await bundle.generate({exports: 'named', format: 'cjs'});
    const chunkMap: { [key: string]: string } = {};
    for (const chunk of generated.output) {
        chunkMap[chunk.fileName] = (chunk as OutputChunk).code;
    }
    return chunkMap;
}

function stringifyChunkMap(chunkMap: { [key: string]: string }) {
    return Object.keys(chunkMap).map(module => `===> ${module}\n${chunkMap[module]}`).join('\n\n');
}
