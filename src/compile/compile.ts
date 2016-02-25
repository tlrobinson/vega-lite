/**
 * Module for compiling Vega-lite spec into Vega spec.
 */

import {LAYOUT} from '../data';
import {Model, buildModel} from './model';
import {normalize} from '../spec';
import {extend} from '../util';


export function compile(inputSpec) {
  // 1. Convert input spec into a normal form
  // (Decompose all extended unit specs into composition of unit spec.)
  const spec = normalize(inputSpec);

  // 2. Instantiate the model with default properties
  const model = buildModel(spec);

  // 3. Compile each part of the model to produce components that will be assembled later
  model.compileData();

  // 4. Assemble a Vega Spec
  return assemble(model);
}

function assemble(model: Model) {
  const config = model.config();

  // TODO: change type to become VgSpec
  const output = extend(
    {
      // Set size to 1 because we rely on padding anyway
      width: 1,
      height: 1,
      padding: 'auto'
    },
    config.viewport ? { viewport: config.viewport } : {},
    config.background ? { background: config.background } : {},
    {
      // TODO: signal: model.assembleSelectionSignal
      data: [].concat(
        model.assembleData([]),
        model.assembleLayout([])
        // TODO: model.assembleSelectionData
      ),
      marks: [assembleRootGroup(model)]
    });

  return {
    spec: output
    // TODO: add warning / errors here
  };
}

export function assembleRootGroup(model: Model) {
  let rootGroup:any = extend({
      name: model.name('root'),
      type: 'group',
    },
    model.description() ? {description: model.description()} : {},
    {
      from: {data: LAYOUT},
      properties: {
        update: extend(
          {
            width: {field: 'width'},
            height: {field: 'height'}
          },
          model.assembleGroupProperties()
        )
      }
    });

  return extend(rootGroup, model.assembleGroup());
}
