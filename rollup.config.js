import nodeResolve from 'rollup-plugin-node-resolve';
import typescript from 'rollup-plugin-typescript';
import commonjs from 'rollup-plugin-commonjs';
import * as ts from 'typescript';

export default {
  entry: './src/vl.ts',
  dest: 'vl.js',
  moduleName: 'vl',
  sourceMap: true,

  format: 'umd',

  plugins: [
    typescript({
      target: ts.ScriptTarget.ES6,
      typescript: ts
    }),
    nodeResolve({
      jsnext: true,
      main: true
    }),
    commonjs({
      include: 'node_modules/**',

      namedExports: {
        'datalib/src/generate.js': [
          'range'
        ],

        'datalib/src/util.js': [
          'duplicate',
          'extend',
          'isArray',
          'isObject',
          'keys',
          'toMap',
          'truncate',
          'vals'
        ]
      }
    })
  ]
}
