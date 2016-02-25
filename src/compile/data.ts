import {AggregateOp} from '../aggregate';
import {autoMaxBins} from '../bin';
import {Channel, COLOR} from '../channel';
import {SOURCE, STACKED_SCALE, SUMMARY} from '../data';
import {field, FieldDef, isCount} from '../fielddef';
import {ScaleType} from '../scale';
import {TimeUnit} from '../timeunit';
import {Formula} from '../transform';
import {QUANTITATIVE, TEMPORAL, ORDINAL} from '../type';
import {extend, keys, vals, reduce, contains, mergeArrays, Dict, StringSet} from '../util';
import {VgData, VgTransform} from '../vega.schema';

import {FacetModel} from './facet';
import {Model} from './model';
import {parseExpression, rawDomain} from './time';
import {UnitModel} from './unit';

const DEFAULT_NULL_FILTERS = {
  nominal: false,
  ordinal: false,
  quantitative: true,
  temporal: true
};

/**
 * Composable component instance of a model's data.
 */
export interface DataComponent {
  source?: VgData;
  formatParse?: Dict<string>;

  /** String set of fields for null filtering */
  nullFilter?: StringSet;

  /** Hashset of a formula object */
  calculate?: Dict<Formula>;

  /** Filter test expression */
  filter?: string;

  /** Dictionary mapping a bin parameter hash to transforms of the binned field */
  bin?: Dict<VgTransform[]>;

  /** Dictionary mapping an output field name (hash) to the time unit transform  */
  timeUnit?: Dict<VgTransform>;

  /** String set of fields to be filtered */
  nonPositiveFilter?: StringSet;

  // TODO: need to revise if single VgData is sufficient with layer / concat
  stack?: VgData;

  /** Dictionary mapping an output field name (hash) to the sort and rank transforms  */
  colorRank?: Dict<VgTransform[]>;

  /** String set of time units that need their own data sources for scale domain */
  timeUnitDomain?: StringSet;

  /** Array of summary component object for producing summary (aggregate) data source */
  summary?: SummaryComponent[];
}

/**
 * Composable component for a model's summary data
 */
interface SummaryComponent {
  /** Name of the summary data source */
  name: string;

  /** Source for the summary data source */
  source: string;

  /** String set for all dimension fields  */
  dimensions: StringSet;

  /** dictionary mapping field name to string set of aggregate ops */
  measures: Dict<StringSet>;
}

// TODO: split this file into multiple files and remove this linter flag
/* tslint:disable:no-use-before-declare */

export function compileUnitData(model: UnitModel): DataComponent {
  let data: DataComponent = {};
  data.source = source.compileUnit(model);
  data.formatParse = formatParse.compileUnit(model);
  data.nullFilter = nullFilter.compileUnit(model);
  data.filter = filter.compileUnit(model);
  data.bin = bin.compileUnit(model);
  data.calculate = formula.compileUnit(model);
  data.timeUnit = timeUnit.compileUnit(model);
  data.timeUnitDomain = timeUnitDomain.compileUnit(model);
  data.summary = summary.compileUnit(model);
  data.stack = stack.compileUnit(model);
  data.colorRank = colorRank.compileUnit(model);
  data.nonPositiveFilter = nonPositiveFilter.compileUnit(model);
  return data;
}

export function compileFacetData(model: FacetModel): DataComponent {
  let data: DataComponent = {};
  data.source = source.compileFacet(model);
  data.formatParse = formatParse.compileFacet(model);
  data.nullFilter = nullFilter.compileFacet(model);
  data.filter = filter.compileFacet(model);
  data.bin = bin.compileFacet(model);
  data.calculate = formula.compileFacet(model);
  data.timeUnit = timeUnit.compileFacet(model);
  data.timeUnitDomain = timeUnitDomain.compileFacet(model);
  data.summary = summary.compileFacet(model);
  data.stack = stack.compileFacet(model);
  data.colorRank = colorRank.compileFacet(model);
  data.nonPositiveFilter = nonPositiveFilter.compileFacet(model);
  return data;
}
/* tslint:enable:no-use-before-declare */

/**
 * Creates Vega Data array from a given compiled model and append all of them to the given array
 *
 * @param  model
 * @param  data array
 * @return modified data array
 */
export function assembleData(model: Model, data: VgData[]) {
  const component = model.component.data;
  if (component.source) {
    let sourceData: VgData = extend(
      { name: model.dataName(SOURCE) },
      component.source
    );
    if (component.formatParse) {
      component.source.format = component.source.format || {};
      component.source.format.parse = component.formatParse;
    }

    // null filter comes first so transforms are not performed on null values
    // time and bin should come before filter so we can filter by time and bin
    sourceData.transform = [].concat(
      nullFilter.assemble(component),
      formula.assemble(component),
      filter.assemble(component),
      bin.assemble(component),
      timeUnit.assemble(component)
    );

    data.push(sourceData);
  }

  summary.assemble(component).forEach(function(summaryData) {
    data.push(summaryData);
  });

  const dataTable = data[data.length - 1];
  dataTable.transform = dataTable.transform || [];

  // color rank
  dataTable.transform.push(colorRank.assemble(component));

  // nonPositiveFilter
  dataTable.transform.push(nonPositiveFilter.assemble(component));

  // stack
  // TODO: revise if this actually should be an array
  const stackData = stack.assemble(component);
  if (stackData) {
    data.push(stackData);
  }

  timeUnitDomain.assemble(component).forEach(function(timeUnitDomainData) {
    data.push(timeUnitDomainData);
  });
  return data;
}

export namespace source {
  function compile(model: Model): VgData {
    const data = model.data();
    if (data) {
      let source: any = {};
      if (data.values && data.values.length > 0) {
        source.values = model.data().values;
        source.format = { type: 'json' };
      } else if (data.url) {
        source.url = data.url;

        // Extract extension from URL using snippet from
        // http://stackoverflow.com/questions/680929/how-to-extract-extension-from-filename-string-in-javascript
        let defaultExtension = /(?:\.([^.]+))?$/.exec(source.url)[1];
        if (!contains(['json', 'csv', 'tsv'], defaultExtension)) {
          defaultExtension = 'json';
        }
        source.format = { type: model.data().formatType || defaultExtension };
      }
      return source;
    }
    return undefined;
  }

  export const compileUnit = compile;
  export const compileFacet = compile;
}

export namespace formatParse {
  // TODO: need to take calculate into account across levels when merging
  function compile(model: Model) {
    const calcFieldMap = (model.transform().calculate || []).reduce(function(fieldMap, formula) {
        fieldMap[formula.field] = true;
        return fieldMap;
    }, {});

    let parse;
    // use forEach rather than reduce so that it can return undefined
    // if there is no parse needed
    model.forEach(function(fieldDef: FieldDef) {
      if (fieldDef.type === TEMPORAL) {
        parse = parse || {};
        parse[fieldDef.field] = 'date';
      } else if (fieldDef.type === QUANTITATIVE) {
        if (isCount(fieldDef) || calcFieldMap[fieldDef.field]) {
            return;
        }
        parse = parse || {};
        parse[fieldDef.field] = 'number';
      }
    });
    return parse;
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    let parse = compile(model);

    // If child doesn't have its own data source, then merge
    const childDataComponent = model.child().component.data;
    if (!childDataComponent.source) {
      extend(parse, childDataComponent.formatParse);
      delete childDataComponent.formatParse;
    }
    return parse;
  }

  // Assemble for formatParse is an identity functio, no need to declare
}


export namespace timeUnit {
  function compile(model: Model) {
    return model.reduce(function(timeUnitComponent, fieldDef: FieldDef, channel: Channel) {
      const ref = field(fieldDef, { nofn: true, datum: true });
      if (fieldDef.type === TEMPORAL && fieldDef.timeUnit) {

        const hash = field(fieldDef);

        timeUnitComponent[hash] = {
          type: 'formula',
          field: field(fieldDef),
          expr: parseExpression(fieldDef.timeUnit, ref)
        };
      }
      return timeUnitComponent;
    }, {});
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    let timeUnitComponent = compile(model);

    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      extend(timeUnitComponent, childDataComponent.timeUnit);
      delete childDataComponent.timeUnit;
    }
    return timeUnitComponent;
  }

  export function assemble(component: DataComponent) {
    // just join the values, which are already transforms
    return vals(component.timeUnit);
  }
}

export namespace bin {
  function compile(model: Model) {
    return model.reduce(function(binComponent, fieldDef: FieldDef, channel: Channel) {
      const bin = model.fieldDef(channel).bin;
      if (bin) {
        let binTrans = extend({
          type: 'bin',
          field: fieldDef.field,
          output: {
            start: field(fieldDef, { binSuffix: '_start' }),
            mid: field(fieldDef, { binSuffix: '_mid' }),
            end: field(fieldDef, { binSuffix: '_end' })
          }
        },
          // if bin is an object, load parameter here!
          typeof bin === 'boolean' ? {} : bin
        );

        if (!binTrans.maxbins && !binTrans.step) {
          // if both maxbins and step are not specified, need to automatically determine bin
          binTrans.maxbins = autoMaxBins(channel);
        }

        const transform = [binTrans];
        const isOrdinalColor = model.isOrdinalScale(channel) || channel === COLOR;
        // color ramp has type linear or time
        if (isOrdinalColor) {
          transform.push({
            type: 'formula',
            field: field(fieldDef, { binSuffix: '_range' }),
            expr: field(fieldDef, { datum: true, binSuffix: '_start' }) +
            ' + \'-\' + ' +
            field(fieldDef, { datum: true, binSuffix: '_end' })
          });
        }
        // FIXME: current merging logic can produce redundant transforms when a field is binned for color and for non-color
        const hash = JSON.stringify(bin) + 'oc:' + isOrdinalColor;
        binComponent[hash] = transform;
      }
      return binComponent;
    }, {});
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    let binComponent = compile(model);

    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      // FIXME: current merging logic can produce redundant transforms when a field is binned for color and for non-color
      extend(binComponent, childDataComponent.bin);
      delete childDataComponent.bin;
    }
    return binComponent;
  }

  export function assemble(component: DataComponent) {
    return mergeArrays(vals(component.bin));
  }
}

export namespace nullFilter {
  /** Return Hashset of fields for null filtering (key=field, value = true). */
  function compile(model: Model) {
    const filterNull = model.transform().filterNull;
    return model.reduce(function(aggregator, fieldDef: FieldDef) {
      if (filterNull ||
        (filterNull === undefined && fieldDef.field && fieldDef.field !== '*' && DEFAULT_NULL_FILTERS[fieldDef.type])) {
        aggregator[fieldDef.field] = true;
      }
      return aggregator;
    }, {});
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    let nullFilterComponent = compile(model);

    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      extend(nullFilterComponent, childDataComponent.nullFilter);
      delete childDataComponent.nullFilter;
    }
    return nullFilterComponent;
  }

  /** Convert the hashset of fields to a filter transform.  */
  export function assemble(component: DataComponent) {
    const filteredFields = keys(component.nullFilter);
    return filteredFields.length > 0 ?
      [{
        type: 'filter',
        test: filteredFields.map(function(fieldName) {
          return 'datum.' + fieldName + '!==null';
        }).join(' && ')
      }] : [];
  }
}

export namespace filter {
  function compile(model: Model): string {
    return model.transform().filter;
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    let filterComponent = compile(model);

    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      // merge by adding &&
      filterComponent += ' && ' + childDataComponent.filter;
      delete childDataComponent.filter;
    }
    return filterComponent;
  }

  export function assemble(component: DataComponent) {
    const filter = component.filter;
    return filter ? [{
      type: 'filter',
      test: filter
    }] : [];
  }
}

export namespace formula {
  function compile(model: Model): Dict<Formula> {
    return (model.transform().calculate || []).reduce(function(formulaComponent, formula) {
      formulaComponent[JSON.stringify(formula)] = formula;
      return formulaComponent;
    }, {} as Dict<Formula>);
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    let formulaComponent = compile(model);

    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      extend(formulaComponent, childDataComponent.calculate);
      delete childDataComponent.calculate;
    }
    return formulaComponent;
  }

  export function assemble(component: DataComponent) {
    return vals(component.calculate).reduce(function(transform, formula) {
      transform.push(extend({ type: 'formula' }, formula));
      return transform;
    }, []);
  }
}

export namespace summary {
  function addDimension(dims: { [field: string]: boolean }, fieldDef: FieldDef) {
    if (fieldDef.bin) {
      dims[field(fieldDef, { binSuffix: '_start' })] = true;
      dims[field(fieldDef, { binSuffix: '_mid' })] = true;
      dims[field(fieldDef, { binSuffix: '_end' })] = true;

      // const scale = model.scale(channel);
      // if (scaleType(scale, fieldDef, channel, model.mark()) === ScaleType.ORDINAL) {
      // also produce bin_range if the binned field use ordinal scale
      dims[field(fieldDef, { binSuffix: '_range' })] = true;
      // }
    } else {
      dims[field(fieldDef)] = true;
    }
  }

  export function compileUnit(model: Model): SummaryComponent[] {
    /* dict set for dimensions */
    let dims: { [field: string]: boolean } = {};

    /* dictionary mapping field name => dict set of aggregation functions */
    let meas: { [field: string]: { [aggregate: string]: boolean } } = {};

    model.forEach(function(fieldDef: FieldDef, channel: Channel) {
      if (fieldDef.aggregate) {
        if (fieldDef.aggregate === AggregateOp.COUNT) {
          meas['*'] = meas['*'] || {};
          /* tslint:disable:no-string-literal */
          meas['*']['count'] = true;
          /* tslint:enable:no-string-literal */
        } else {
          meas[fieldDef.field] = meas[fieldDef.field] || {};
          meas[fieldDef.field][fieldDef.aggregate] = true;
        }
      } else {
        addDimension(dims, fieldDef);
      }
    });

    return [{
      name: model.dataName(SUMMARY),
      source: model.dataName(SOURCE),
      dimensions: dims,
      measures: meas
    }];
  }

  export function compileFacet(model: FacetModel): SummaryComponent[] {
    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      let summaryComponents = childDataComponent.summary.map(function(summaryComponent) {
        // FIXME: the name and source aren't always correct yet when faceting layer/concat
        summaryComponent.name = model.dataName(SUMMARY);
        summaryComponent.source = model.dataName(SOURCE);

        // add facet fields as dimensions
        summaryComponent.dimensions = model.reduce(function(dimensions, fieldDef) {
          addDimension(dimensions, fieldDef);
        }, summaryComponent.dimensions);
        return summaryComponent;
      });

      delete childDataComponent.summary;
      return summaryComponents;
    }
    return [];
  }

  export function assemble(component: DataComponent): VgData[] {
    if (!component.summary) {
      return [];
    }
    return component.summary.reduce(function(summaryData, summaryComponent) {
      const dims = summaryComponent.dimensions;
      const meas = summaryComponent.measures;

      const groupby = keys(dims);

      // short-format summarize object for Vega's aggregate transform
      // https://github.com/vega/vega/wiki/Data-Transforms#-aggregate
      const summarize = reduce(meas, function(aggregator, fnDictSet, field) {
        aggregator[field] = keys(fnDictSet);
        return aggregator;
      }, {});

      if (keys(meas).length > 0) { // has aggregate
        summaryData.push({
          name: summaryComponent.name,
          source: summaryComponent.source,
          transform: [{
            type: 'aggregate',
            groupby: groupby,
            summarize: summarize
          }]
        });
      }
      return summaryData;
    }, []);
  }
}

export namespace stack {
  /**
   * Add stacked data source, for feeding the shared scale.
   */
  export function compileUnit(model: UnitModel):VgData {
    const stackProps = model.stack();
    const groupbyChannel = stackProps.groupbyChannel;
    const fieldChannel = stackProps.fieldChannel;
    const stacked: VgData = {
      name: model.dataName(STACKED_SCALE),
      source: model.dataTable(),
      transform: [{
        type: 'aggregate',
        // group by channel and other facets
        groupby: [model.field(groupbyChannel)],
        // produce sum of the field's value e.g., sum of sum, sum of distinct
        summarize: [{ops: ['sum'], field: model.field(fieldChannel)}]
      }]
    };

    return stacked;
  };

  export function compileFacet(model: FacetModel) {
    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then merge
    if (!childDataComponent.source) {
      let stackComponent = childDataComponent.stack;

      // Add more dimensions for row/column
      stackComponent.transform[0].groupby = model.reduce(function(groupby, fieldDef) {
        groupby.push(field(fieldDef));
        return groupby;
      }, stackComponent.transform[0].groupby);

      delete childDataComponent.stack;
      return stackComponent;
    }
    return null;
  }

  export function assemble(component: DataComponent) {
    return component.stack;
  }
}


export namespace timeUnitDomain {
  function compile(model: Model) {
    return model.reduce(function(timeUnitDomainMap, fieldDef: FieldDef, channel: Channel) {
      if (fieldDef.timeUnit) {
        const domain = rawDomain(fieldDef.timeUnit, channel);
        if (domain) {
          timeUnitDomainMap[fieldDef.timeUnit] = true;
        }
      }
      return timeUnitDomainMap;
    }, {});
  }

  export const compileUnit = compile;

  export function compileFacet(model: FacetModel) {
    // always merge with child
    return extend(compile(model), model.child().component.data.timeUnitDomain);
  }

  export function assemble(component: DataComponent): VgData[] {
    return keys(component.timeUnitDomain).reduce(function(timeUnitData, tu: any) {
      const timeUnit: TimeUnit = tu; // cast string back to enum
      const domain = rawDomain(timeUnit, null); // FIXME fix rawDomain signature
      if (domain) {
        timeUnitData.push({
          name: timeUnit,
          values: domain,
          transform: [{
            type: 'formula',
            field: 'date',
            expr: parseExpression(timeUnit, 'datum.data', true)
          }]
        });
      }
      return timeUnitData;
    }, []);
  }
}

/**
 * We need to add a rank transform so that we can use the rank value as
 * input for color ramp's linear scale.
 */
export namespace colorRank {
  /**
   * Return hash dict from a color field's name to the sort and rank transforms
   */
  export function compileUnit(model: Model) {
    let colorRankComponent: Dict<VgTransform[]> = {};
    if (model.has(COLOR) && model.fieldDef(COLOR).type === ORDINAL) {
      colorRankComponent[model.field(COLOR)] = [{
        type: 'sort',
        by: model.field(COLOR)
      }, {
        type: 'rank',
        field: model.field(COLOR),
        output: {
          rank: model.field(COLOR, { prefn: 'rank_' })
        }
      }];
    }
    return colorRankComponent;
  }

  export function compileFacet(model: FacetModel) {
    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then consider merging
    if (!childDataComponent.source) {
      // TODO: we have to see if color has union scale here

      // For now, let's assume it always has union scale
      const colorRankComponent = childDataComponent.colorRank;
      delete childDataComponent.colorRank;
      return colorRankComponent;
    }
    return null;
  }

  export function assemble(component: DataComponent) {
    return mergeArrays(vals(component.colorRank));
  }
}


/**
 * Filter non-positive value for log scale
 */
export namespace nonPositiveFilter {
  export function compileUnit(model: Model) {
    return model.channels().reduce(function(nonPositiveComponent, channel) {
      const scale = model.scale(channel);
      if (scale && scale.type === ScaleType.LOG) {
        nonPositiveComponent[model.field(channel)] = true;
      }
      return nonPositiveComponent;
    }, {} as StringSet);
  }

  export function compileFacet(model: FacetModel) {
    const childDataComponent = model.child().component.data;

    // If child doesn't have its own data source, then consider merging
    if (!childDataComponent.source) {
      // For now, let's assume it always has union scale
      const nonPositiveFilterComponent = childDataComponent.nonPositiveFilter;
      delete childDataComponent.nonPositiveFilter;
      return nonPositiveFilterComponent;
    }
    return null;
  }

  export function assemble(component: DataComponent) {
    return keys(component.nonPositiveFilter).map(function(field) {
      return {
        type: 'filter',
        test: 'datum.' + field + ' > 0'
      };
    });
  }
}
