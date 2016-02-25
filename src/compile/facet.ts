import {COLUMN, ROW, X, Y, Channel} from '../channel';
import {SOURCE} from '../data';
import {Facet} from '../facet';
import {FieldDef, isDimension} from '../fielddef';
import {FacetSpec} from '../spec';
import * as util from '../util';
import {extend} from '../util';
import {VgData} from '../vega.schema';

import {compileAxis, compileInnerAxis, gridShow} from './axis';
import {applyConfig, FILL_STROKE_CONFIG} from './common';
import {assembleData, compileFacetData} from './data';
import {assembleLayout, compileFacetLayout} from './layout';
import {Model, buildModel} from './model';
import {compileScale} from './scale';



export class FacetModel extends Model {
  private _facet: Facet;

  private _child: Model;

  constructor(spec: FacetSpec) {
    super(spec);

    this._facet = spec.facet;
    this._child = buildModel(spec.spec);
  }

  public compileGroup() {
    return facetMixins(this);
  }

  public facet() {
    return this._facet;
  }

  public has(channel: Channel): boolean {
    return !!this._facet[channel];
  }

  public child() {
    return this._child;
  }

  public dataTable() {
    return SOURCE; // FIXME: this is likely incorrect
  }

  public fieldDef(channel: Channel): FieldDef {
    return this.facet()[channel];
  }

  public stack() {
    return null; // this is only a property for UnitModel
  }

  public compileData() {
    this.component.data = compileFacetData(this);
  }

  public compileLayout() {
    this.component.layout = compileFacetLayout(this);
  }

  public compileScale() {
    // First, add scale for row and column.
    this.component.scale = compileScale(this);
    // Then, move shared/union from its child spec.

    // FIXME: we should check if each scale is shared, but for now always assume shared scale
    extend(this.component.scale, this._child.component.scale);
    this._child.component.scale = {};
  }

  public compileMark() {
    throw new Error("Unimplemented");
  }

  public compileAxis() {
    throw new Error("Unimplemented");
  }

  public compileLegend() {
    // TODO: support legend for independent non-position scale across facets

    // For now, assuming that non-positional scales are always shared across facets
    // Thus, just move all legends from its child
    this.component.legend = this._child.component.legend;
    this._child.component.legend = {};
  }

  public assembleGroupProperties() {
    return null;
  }

  public assembleData(data: VgData[]): VgData[] {
    // Top-down data order (prefix traversal)
    assembleData(this, data);
    return this._child.assembleData(data);
  }

  public assembleLayout(layoutData: VgData[]): VgData[] {
    // Bottom-up data order (post-fix traversal)
    this._child.assembleLayout(layoutData);
    return assembleLayout(this, layoutData);
  }

  public assembleMarks(): any[] {
    // TODO: have to call children's assembleGroup()
    throw new Error("Unimplemented");
  }

  public channels() {
    return [ROW, COLUMN];
  }

  protected mapping() {
    return this.facet();
  }
}

// TODO: move the rest of the file into FacetModel

/**
 * return mixins that contains marks, scales, and axes for the rootGroup
 */
export function facetMixins(model: FacetModel) {
  const hasRow = model.has(ROW), hasCol = model.has(COLUMN);

  if (model.has(ROW) && !isDimension(model.facet().row)) {
    // TODO: add error to model instead
    util.error('Row encoding should be ordinal.');
  }

  if (model.has(COLUMN) && !isDimension(model.facet().column)) {
    // TODO: add error to model instead
    util.error('Col encoding should be ordinal.');
  }

  let mixins: any = { // TODO: VgGroup
    marks: [].concat(
      getFacetGuideGroups(model),
      [getFacetGroup(model)]
    ),
    // assuming equal cellWidth here
    scales: model.assembleScales()
  };

  const axes = [].concat(
    hasRow && model.axis(ROW) ? [compileAxis(ROW, model)] : [],
    hasCol && model.axis(COLUMN) ? [compileAxis(COLUMN, model)] : []
  );
  if (axes.length > 0) {
    mixins.axes = axes;
  }

  return mixins;
}

function getCellAxes(model: Model) {
  const cellAxes = [];
  if (model.has(X) && model.axis(X) && gridShow(model, X)) {
    cellAxes.push(compileInnerAxis(X, model));
  }
  if (model.has(Y) && model.axis(Y) && gridShow(model, Y)) {
    cellAxes.push(compileInnerAxis(Y, model));
  }
  return cellAxes;
}

function getFacetGroup(model: FacetModel) {
  let facetGroup: any = {
    name: model.name('cell'),
    type: 'group',
    from: extend(
      model.dataTable() ? {data: model.dataTable()} : {},
      {
        transform: [{
          type: 'facet',
          groupby: [].concat(
            model.has(ROW) ? [model.field(ROW)] : [],
            model.has(COLUMN) ? [model.field(COLUMN)] : []
          )
        }]
      }
    ),
    properties: {
      update: getFacetGroupProperties(model)
    }
  };

  extend(facetGroup, model.child().assembleGroup());

  // FIXME: revise this part
  const cellAxes = getCellAxes(model.child());
  if (cellAxes.length > 0) {
    facetGroup.axes = cellAxes;
  }
  return facetGroup;
}

function getFacetGroupProperties(model: Model) {
  let facetGroupProperties: any = {
    x: model.has(COLUMN) ? {
        scale: model.scaleName(COLUMN),
        field: model.field(COLUMN),
        // offset by the padding
        offset: model.scale(COLUMN).padding / 2
      } : {value: model.config().facet.scale.padding / 2},

    y: model.has(ROW) ? {
      scale: model.scaleName(ROW),
      field: model.field(ROW),
      // offset by the padding
      offset: model.scale(ROW).padding / 2
    } : {value: model.config().facet.scale.padding / 2},

    width: {field: {parent: 'cellWidth'}},
    height: {field: {parent: 'cellHeight'}}
  };

  // apply both config from cell and facet.cell (with higher precedence for facet.cell)
  applyConfig(facetGroupProperties, model.config().cell, FILL_STROKE_CONFIG.concat(['clip']));
  applyConfig(facetGroupProperties, model.config().facet.cell, FILL_STROKE_CONFIG.concat(['clip']));

  return facetGroupProperties;
}

/**
 * Return groups of axes or manually drawn grids.
 */
function getFacetGuideGroups(model: Model) {
  let rootAxesGroups = [] ;

  if (model.has(X)) {
    if (model.axis(X)) {
      rootAxesGroups.push(getXAxesGroup(model));
    }
  } else {
    // TODO: consider if row has axis and if row's axis.grid is true
    if (model.has(ROW)) {
      // manually draw grid (use apply to push all members of an array)
      rootAxesGroups.push.apply(rootAxesGroups, getRowGridGroups(model));
    }
  }
  if (model.has(Y)) {
    if (model.axis(Y)) {
      rootAxesGroups.push(getYAxesGroup(model));
    }
  } else {
    // TODO: consider if column has axis and if column's axis.grid is true
    if (model.has(COLUMN)) {
      // manually draw grid (use apply to push all members of an array)
      rootAxesGroups.push.apply(rootAxesGroups, getColumnGridGroups(model));
    }
  }

  return rootAxesGroups;
}

function getXAxesGroup(model: Model) { // TODO: VgMarks
  const hasCol = model.has(COLUMN);
  return extend(
    {
      name: model.name('x-axes'),
      type: 'group'
    },
    hasCol ? {
      from: { // TODO: if we do facet transform at the parent level we can same some transform here
        data: model.dataTable(),
        transform: [{
          type: 'aggregate',
          groupby: [model.field(COLUMN)],
          summarize: {'*': ['count']} // just a placeholder aggregation
        }]
      }
    } : {},
    {
      properties: {
        update: {
          width: {field: {parent: 'cellWidth'}},
          height: {
            field: {group: 'height'}
          },
          x: hasCol ? {
            scale: model.scaleName(COLUMN),
            field: model.field(COLUMN),
            // offset by the padding
            offset: model.scale(COLUMN).padding / 2
          } : {
            // offset by the padding
            value: model.config().facet.scale.padding / 2
          }
        }
      }
    },
    model.axis(X) ? {
      axes: [compileAxis(X, model)]
    }: {}
  );
}

function getYAxesGroup(model: Model) { // TODO: VgMarks
  const hasRow = model.has(ROW);
  return extend(
    {
      name: model.name('y-axes'),
      type: 'group'
    },
    hasRow ? {
      from: {
        data: model.dataTable(),
        transform: [{
          type: 'aggregate',
          groupby: [model.field(ROW)],
          summarize: {'*': ['count']} // just a placeholder aggregation
        }]
      }
    } : {},
    {
      properties: {
        update: {
          width: {
            field: {group: 'width'}
          },
          height: {field: {parent: 'cellHeight'}},
          y: hasRow ? {
            scale: model.scaleName(ROW),
            field: model.field(ROW),
            // offset by the padding
            offset: model.scale(ROW).padding / 2
          } : {
            // offset by the padding
            value: model.config().facet.scale.padding / 2
          }
        }
      },
    },
    model.axis(Y) ? {
      axes: [compileAxis(Y, model)]
    }: {}
  );
}

function getRowGridGroups(model: Model): any[] { // TODO: VgMarks
  const facetGridConfig = model.config().facet.grid;

  const rowGrid = {
    name: model.name('row-grid'),
    type: 'rule',
    from: {
      data: model.dataTable(),
      transform: [{type: 'facet', groupby: [model.field(ROW)]}]
    },
    properties: {
      update: {
        y: {
          scale: model.scaleName(ROW),
          field: model.field(ROW)
        },
        x: {value: 0, offset: -facetGridConfig.offset },
        x2: {field: {group: 'width'}, offset: facetGridConfig.offset },
        stroke: { value: facetGridConfig.color },
        strokeOpacity: { value: facetGridConfig.opacity },
        strokeWidth: {value: 0.5}
      }
    }
  };

  return [rowGrid, {
    name: (name ? name + '-' : '') + 'row-grid-end',
    type: 'rule',
    properties: {
      update: {
        y: { field: {group: 'height'}},
        x: {value: 0, offset: -facetGridConfig.offset },
        x2: {field: {group: 'width'}, offset: facetGridConfig.offset },
        stroke: { value: facetGridConfig.color },
        strokeOpacity: { value: facetGridConfig.opacity },
        strokeWidth: {value: 0.5}
      }
    }
  }];
}

function getColumnGridGroups(model: Model): any { // TODO: VgMarks
  const facetGridConfig = model.config().facet.grid;

  const columnGrid = {
    name: model.name('column-grid'),
    type: 'rule',
    from: {
      data: model.dataTable(),
      transform: [{type: 'facet', groupby: [model.field(COLUMN)]}]
    },
    properties: {
      update: {
        x: {
          scale: model.scaleName(COLUMN),
          field: model.field(COLUMN)
        },
        y: {value: 0, offset: -facetGridConfig.offset},
        y2: {field: {group: 'height'}, offset: facetGridConfig.offset },
        stroke: { value: facetGridConfig.color },
        strokeOpacity: { value: facetGridConfig.opacity },
        strokeWidth: {value: 0.5}
      }
    }
  };

  return [columnGrid,  {
    name: (name ? name + '-' : '') + 'column-grid-end',
    type: 'rule',
    properties: {
      update: {
        x: { field: {group: 'width'}},
        y: {value: 0, offset: -facetGridConfig.offset},
        y2: {field: {group: 'height'}, offset: facetGridConfig.offset },
        stroke: { value: facetGridConfig.color },
        strokeOpacity: { value: facetGridConfig.opacity },
        strokeWidth: {value: 0.5}
      }
    }
  }];
}
