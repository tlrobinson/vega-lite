
import {Channel, X, Y, ROW, COLUMN} from '../channel';
import {LAYOUT} from '../data';
import {ScaleType} from '../scale';
import {Formula} from '../transform';
import {extend, keys, Dict, StringSet} from '../util';
import {VgData} from '../vega.schema';


import {FacetModel} from './facet';
import {TEXT as TEXT_MARK} from '../mark';
import {Model} from './model';
import {rawDomain} from './time';
import {UnitModel} from './unit';

// FIXME: for nesting x and y, we need to declare x,y layout separately before joining later
// For now, let's always assume shared scale
export interface LayoutComponent {
  width: SizeComponent;
  height: SizeComponent;
}

export interface SizeComponent {
  /** Field that we need to calculate distinct */
  distinct: StringSet;

  /** Dict from field name to expression */
  formula: Formula[];
}

export function assembleLayout(model: Model, layoutData: VgData[]): VgData[] {
  const layoutComponent = model.component.layout;
  if (!layoutComponent.width && !layoutComponent.height) {
    return layoutData; // Do nothing
  }

  if (true) { // if both are shared scale, we can simply merge data source for width and for height
    const distinctFields = keys(extend(layoutComponent.width.distinct, layoutComponent.height.distinct));
    const formula = layoutComponent.width.formula.concat(layoutComponent.height.formula);

    return [
      distinctFields.length > 0 ? {
        name: LAYOUT,
        source: model.dataTable(),
        transform: [{
            type: 'aggregate',
            summarize: distinctFields.map(function(field) {
              return { field: field, ops: ['distinct'] };
            })
          }].concat(formula.map(function(formula) {
            return extend({type: 'formula'}, formula);
          }))
      } : {
        name: LAYOUT,
        values: [{}],
        transform: formula
      }
    ];
  }
  // FIXME: implement
  // otherwise, we need to join width and height (cross)
}

// FIXME: for nesting x and y, we need to declare x,y layout separately before joining later
// For now, let's always assume shared scale
export function compileUnitLayout(model: UnitModel): LayoutComponent {
  return {
    width: compileUnitSizeLayout(model, X),
    height: compileUnitSizeLayout(model, Y)
  };
}

function compileUnitSizeLayout(model: UnitModel, channel: Channel): SizeComponent {
  const nonOrdinalSize = channel === X ? model.cellWidth() : model.cellHeight();
  let formula = {};

  return {
    distinct: getDistinct(model, channel),
    formula: [{
      field: model.sizeName(channel),
      expr: unitSizeExpr(model, channel, nonOrdinalSize)
    }]
  };
}

function unitSizeExpr(model: UnitModel, channel: Channel, nonOrdinalSize: number): string {
  if (model.has(channel)) {
    if (model.isOrdinalScale(channel)) {
      const scale = model.scale(channel);
      return '(' + cardinalityFormula(model, channel) +
        ' + ' + scale.padding +
        ') * ' + scale.bandSize;
    } else {
      return nonOrdinalSize + '';
    }
  } else {
    if (model.mark() === TEXT_MARK && channel === X) {
      // for text table without x/y scale we need wider bandSize
      return model.config().scale.textBandWidth + '';
    }
    return model.config().scale.bandSize + '';
  }
}

export function compileFacetLayout(model: FacetModel): LayoutComponent {
  return {
    width: compileFacetSizeLayout(model, COLUMN),
    height: compileFacetSizeLayout(model, ROW)
  };
}

function compileFacetSizeLayout(model: FacetModel, channel: Channel): SizeComponent {
  const childLayoutComponent = model.child().component.layout;
  const sizeType = channel === ROW ? 'height' : 'width';
  const childSizeComponent: SizeComponent = childLayoutComponent[sizeType];

  if (true) { // assume shared scale
    // For shared scale, we can simply merge the layout into one data source

    const distinct = extend(getDistinct(model, channel), childSizeComponent.distinct);
    const formula = childSizeComponent.formula.concat([{
      field: model.sizeName(channel),
      expr: facetSizeFormula(model, channel, model.child().sizeName(channel))
    }]);

    delete childLayoutComponent[sizeType];
    return {
      distinct: distinct,
      formula: formula
    };
  }
  // FIXME implement independent scale as well
  // TODO: - also consider when children have different data source
}

function facetSizeFormula(model: Model, channel: Channel, innerSize: string) {
  const scale = model.scale(channel);
  if (model.has(channel)) {
    return '(datum.' + innerSize + ' + ' + scale.padding + ')' + ' * ' + cardinalityFormula(model, channel);
  } else {
    return innerSize + ' + ' + model.config().facet.scale.padding; // need to add outer padding for facet
  }
}

function getDistinct(model: Model, channel: Channel): StringSet {
  if (model.has(channel) && model.isOrdinalScale(channel)) {
    const scale = model.scale(channel);
    if (scale.type === ScaleType.ORDINAL && !(scale.domain instanceof Array)) {
      // if explicit domain is declared, use array length
      const distinctField = model.field(channel);
      let distinct: StringSet = {};
      distinct[distinctField] = true;
      return distinct;
    }
  }
  return {};
}

// TODO: rename to cardinalityExpr
function cardinalityFormula(model: Model, channel: Channel) {
  const scale = model.scale(channel);
  if (scale.domain instanceof Array) {
    return scale.domain.length;
  }

  const timeUnit = model.fieldDef(channel).timeUnit;
  const timeUnitDomain = timeUnit ? rawDomain(timeUnit, channel) : null;

  return timeUnitDomain !== null ? timeUnitDomain.length :
        model.field(channel, {datum: true, prefn: 'distinct_'});
}
