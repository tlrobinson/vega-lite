/* tslint:disable:quotemark */

import {assert} from 'chai';
import {compileUnitData, assembleData} from '../../src/compile/data';
import {bin} from '../../src/compile/data';
import {filter} from '../../src/compile/data';
import {nullFilter} from '../../src/compile/data';
import {source} from '../../src/compile/data';
import {stack} from '../../src/compile/data';
import {summary} from '../../src/compile/data';
import {timeUnit} from '../../src/compile/data';
import {timeUnitDomain} from '../../src/compile/data';
import {formatParse} from '../../src/compile/data';
import {nonPositiveFilter} from '../../src/compile/data';
import {parseModel} from '../util';
import {mergeDeep, vals} from '../../src/util';

function compileAssembleUnitData(model) {
  compileUnitData(model);
  return assembleData(model, []);
}

describe('data', function () {
  describe('compileData & assembleData', function () {
    describe('for aggregate encoding', function () {
      it('should contain 2 tables', function() {
        const model = parseModel({
            mark: "point",
            encoding: {
              x: {field: 'a', type: "temporal"},
              y: {field: 'b', type: "quantitative", scale: {type: 'log'}, aggregate: 'sum'}
            }
          });

        const data = compileAssembleUnitData(model);
        assert.equal(data.length, 2);
      });
    });

    describe('when contains log in non-aggregate', function () {
      const model = parseModel({
          mark: "point",
          encoding: {
            x: {field: 'a', type: "temporal"},
            y: {field: 'b', type: "quantitative", scale: {type: 'log'}}
          }
        });

      const data = compileAssembleUnitData(model);
      it('should contains 1 table', function() {
        assert.equal(data.length, 1);
      });
      it('should have filter non-positive in source', function() {
        const sourceTransform = data[0].transform;
        assert.deepEqual(sourceTransform[sourceTransform.length - 1], {
          type: 'filter',
          test: 'datum.b > 0'
        });
      });
    });
  });

  describe('assemble', function () {
    it('should have correct order of transforms (null filter, timeUnit, bin then filter)', function () {
      const model = parseModel({
        transform: {
          calculate: [{
            field: 'b2',
            expr: '2 * datum.b'
          }],
          filter: 'datum.a > datum.b && datum.c === datum.d'
        },
        mark: "point",
        encoding: {
          x: {field: 'a', type: "temporal", timeUnit: 'year'},
          y: {
            bin: {
              min: 0,
              max: 100
            },
            'field': 'Acceleration',
            'type': "quantitative"
          },
          size: {field: 'b2', type:'quantitative'}
        }
      });
      const transform = compileAssembleUnitData(model)[0].transform;
      assert.deepEqual(transform[0].type, 'filter');
      assert.deepEqual(transform[1].type, 'formula');
      assert.deepEqual(transform[2].type, 'filter');
      assert.deepEqual(transform[3].type, 'bin');
      assert.deepEqual(transform[4].type, 'formula');
    });
  });
});

describe('data: source', function() {
  describe('compileUnit', function() {
    describe('with explicit values', function() {
      const model = parseModel({
        data: {
          values: [{a: 1, b:2, c:3}, {a: 4, b:5, c:6}]
        }
      });

      const sourceComponent = source.compileUnit(model);

      it('should have values', function() {
        assert.equal(sourceComponent.name, 'source');
        assert.deepEqual(sourceComponent.values, [{a: 1, b:2, c:3}, {a: 4, b:5, c:6}]);
      });

      it('should have source.format', function(){
        assert.deepEqual(sourceComponent.format, {type: 'json'});
      });
    });

    describe('with link to url', function() {
      const model = parseModel({
          data: {
            url: 'http://foo.bar'
          }
        });

      const sourceComponent = source.compileUnit(model);

      it('should have format json', function() {
        assert.equal(sourceComponent.name, 'source');
        assert.equal(sourceComponent.format.type, 'json');
      });
      it('should have correct url', function() {
        assert.equal(sourceComponent.url, 'http://foo.bar');
      });
    });
  });
});


describe('data: formatParse', function () {
  describe('compileUnit', function() {
    it('should include parse for all applicable fields, and exclude calculated fields', function() {
      const model = parseModel({
        transform: {
          calculate: [
            {field: 'b2', expr: 'datum.b * 2'}
          ]
        },
        mark: "point",
        encoding: {
          x: {field: 'a', type: "temporal"},
          y: {field: 'b', type: "quantitative"},
          color: {field: '*', type: "quantitative", aggregate: 'count'},
          size: {field: 'b2', type: "quantitative"},
        }
      });

      const formatParseComponent = formatParse.compileUnit(model);
      assert.deepEqual(formatParseComponent, {
        'a': 'date',
        'b': 'number'
      });
    });
  });


  describe('assemble', function() {
    // TODO: write test
  });
});

describe('data: bin', function() {
  describe('compileUnit', function() {
    const model = parseModel({
      mark: "point",
      encoding: {
        y: {
          bin: { min: 0, max: 100 },
          'field': 'Acceleration',
          'type': "quantitative"
        }
      }
    });
    it('should add bin transform and correctly apply bin', function() {
      const transform = vals(bin.compileUnit(model))[0];

      assert.deepEqual(transform[0], {
        type: 'bin',
        field: 'Acceleration',
        output: {
          start: 'bin_Acceleration_start',
          mid: 'bin_Acceleration_mid',
          end: 'bin_Acceleration_end'
        },
        maxbins: 10,
        min: 0,
        max: 100
      });
    });
  });

  describe('assemble', function() {
    // TODO: write test
  });
});

describe('data: nullFilter', function() {
  describe('compileUnit', function() {
    const spec = {
      mark: "point",
      encoding: {
        y: {field: 'qq', type: "quantitative"},
        x: {field: 'tt', type: "temporal"},
        color: {field: 'oo', type: "ordinal"}
      }
    };

    it('should add filterNull for Q and T by default', function () {
      const model = parseModel(spec);
      assert.deepEqual(nullFilter.compileUnit(model), {
        qq: true,
        tt: true
      });
    });

    it('should add filterNull for O when specified', function () {
      const model = parseModel(mergeDeep(spec, {
        transform: {
          filterNull: true
        }
      }));
      assert.deepEqual(nullFilter.compileUnit(model), {
        qq: true,
        tt: true,
        oo: true
      });
    });

    it('should add no null filter if filterNull is false', function () {
      const model = parseModel(mergeDeep(spec, {
        transform: {
          filterNull: false
        }
      }));
      assert.deepEqual(nullFilter.compileUnit(model), {});
    });
  });

  describe('compileFacet', function() {
    // TODO: write
  });

  describe('assemble', function() {
    // TODO: write
  });
});

describe('data: filter', function () {
  describe('compileUnit', function () {
    const model = parseModel({
      transform: {
        filter: 'datum.a > datum.b && datum.c === datum.d'
      }
    });
    it('should return array that contains a filter transform', function () {
      assert.deepEqual(filter.compileUnit(model), 'datum.a > datum.b && datum.c === datum.d');
    });
  });

  describe('assemble', function() {
    // TODO: write
  });
});

describe('data: formula', function() {
  describe('unit', function() {
    // FIXME: write
  });

  describe('facet', function() {
    // FIXME: write
  });
});

describe('data: timeUnit', function () {
  describe('compileUnit', function() {
    const model = parseModel({
      mark: "point",
      encoding: {
        x: {field: 'a', type: "temporal", timeUnit: 'year'}
      }
    });
    it('should add formula transform', function() {
      const transform = vals(timeUnit.compileUnit(model));
      assert.deepEqual(transform[0], {
        type: 'formula',
        field: 'year_a',
        expr: 'datetime(year(datum.a), 0, 1, 0, 0, 0, 0)'
      });
    });
  });

  describe('compileFacet', function() {
    // TODO: write
  });

  describe('assemble', function() {
    // TODO: write
  });
});


describe('data: timeUnitDomain', function() {
  describe('unit: day', function() {
    const model = parseModel({
      mark: "point",
      encoding: {
        'y': {
          'aggregate': 'sum',
          'field': 'Acceleration',
          'type': "quantitative"
        },
        'x': {
          'field': 'date',
          'type': "temporal",
          'timeUnit': 'day'
        }
      }
    });

    it('should be compiled into correct string set', function() {
      model.component.data.timeUnitDomain = timeUnitDomain.compileUnit(model);
      assert.deepEqual(model.component.data.timeUnitDomain, {day: true});
    });

    it('should assemble data source with raw domain data', function() {
      const defs = timeUnitDomain.assemble(model.component.data);

      assert.deepEqual(defs, [{
        name: 'day',
        transform: [
          {
            expr: 'datetime(2006, 0, datum.data+1, 0, 0, 0, 0)',
            field: 'date',
            type: 'formula'
          }
        ],
        values: [0,1,2,3,4,5,6]
      }]);
    });
  });

  describe('unit: day', function() {
    // TODO: write more unit test for other timeUnit domain, for both ones that produces
    // custom domain and one that do not.
  });

  describe('facet', function() {
    // TODO: write
  });
});

describe('data: colorRank', function () {
  // TODO: write
});

describe('data: nonPositiveFilter', function () {
  describe('unit (with log scale)', function() {
    const model = parseModel({
      mark: "point",
      encoding: {
        x: {field: 'a', type: "temporal"},
        y: {field: 'b', type: "quantitative", scale: {type: 'log'}}
      }
    });
    it('should produce the correct nonPositiveFilter component' ,function (){
      model.component.data.nonPositiveFilter = nonPositiveFilter.compileUnit(model);
      assert.deepEqual(model.component.data.nonPositiveFilter, {
        b: true
      });
    });

    it('should assemble the correct filter transform', function() {
      const filterTransform = nonPositiveFilter.assemble(model.component.data)[0];
      assert.deepEqual(filterTransform, {
        type: 'filter',
        test: 'datum.b > 0'
      });
    });
  });

  describe('unit (with aggregated log scale)', function() {
    // TODO: write
  });

  describe('facet', function() {
    // TODO: write
  });
});

describe('data: stack', function() {
  describe('unit (bin-x)', function() {
    const model = parseModel({
      "mark": "bar",
      "encoding": {
        "x": {"type": "quantitative", "field": "Cost__Other", "aggregate": "sum"},
        "y": {"bin": true, "type": "quantitative", "field": "Cost__Total_$"},
        "color": {"type": "ordinal", "field": "Effect__Amount_of_damage"}
      }
    });
    model.component.data.stack = stack.compileUnit(model);

    it('should produce the correct nonPositiveFilter component', function() {
      const stackedData = model.component.data.stack;
      assert.equal(stackedData.transform[0].groupby[0], 'bin_Cost__Total_$_start');
    });

    it('should assemble stack summary data correctly', function() {
      // simply return identity
      const summaryData = stack.assemble(model.component.data);
      assert.deepEqual(summaryData, model.component.data.stack);
    });
  });

  describe('unit (bin-y)', function() {
    const model = parseModel({
      "mark": "bar",
      "encoding": {
        "y": {"type": "quantitative", "field": "Cost__Other", "aggregate": "sum"},
        "x": {"bin": true, "type": "quantitative", "field": "Cost__Total_$"},
        "color": {"type": "ordinal", "field": "Effect__Amount_of_damage"}
      }
    });

    model.component.data.stack = stack.compileUnit(model);

    it('should produce the correct nonPositiveFilter component', function() {
      const stackedData = model.component.data.stack;
      assert.equal(stackedData.transform[0].groupby[0], 'bin_Cost__Total_$_start');
    });

    it('should assemble stack summary data correctly', function() {
      // simply return identity
      const summaryData = stack.assemble(model.component.data);
      assert.deepEqual(summaryData, model.component.data.stack);
    });
  });

  describe('facet', function() {

  });
});

describe('data: summary', function () {
  describe('unit (aggregated)', function() {
    const model = parseModel({
      mark: "point",
      encoding: {
        'y': {
          'aggregate': 'sum',
          'field': 'Acceleration',
          'type': "quantitative"
        },
        'x': {
          'field': 'origin',
          'type': "ordinal"
        },
        color: {field: '*', type: "quantitative", aggregate: 'count'}
      }
    });

    model.component.data.summary = summary.compileUnit(model);

    it('should produce the correct summary component' ,function() {
      assert.deepEqual(model.component.data.summary, {
        name: 'summary',
        source: 'source',
        dimensions: {Origin: true},
        measures: {'*':{count: true}, Acceleration: {sum: true}}
      });
    });

    it('should assemble the correct aggregate transform', function() {
      const summaryData = summary.assemble(model.component.data)[0];
      assert.deepEqual(summaryData, {
        'name': "summary",
        'source': 'source',
        'transform': [{
          'type': 'aggregate',
          'groupby': ['origin'],
          'summarize': {
            '*': ['count'],
            'Acceleration': ['sum']
          }
        }]
      });
    });
  });

  describe('unit (aggregated with detail arrays)', function() {
    const model = parseModel({
      mark: "point",
      encoding: {
        'x': { 'aggregate': 'mean', 'field': 'Displacement', 'type': "quantitative"},
        'detail': [
          {'field': 'Origin', 'type': "ordinal"},
          {'field': 'Cylinders', 'type': "quantitative"}
        ]
      }
    });

    it('should produce the correct summary component', function() {
      model.component.data.summary = summary.compileUnit(model);
      assert.deepEqual(model.component.data.summary, {
        name: 'summary',
        source: 'source',
        dimensions: {Origin: true, Cylinders: true},
        measures: {Displacement: {mean: true}}
      });
    });

    it('should assemble the correct summary data', function() {
      const summaryData = summary.assemble(model.component.data)[0];
      assert.deepEqual(summaryData, {
        'name': "summary",
        'source': 'source',
        'transform': [{
          'type': 'aggregate',
          'groupby': ['Origin', 'Cylinders'],
          'summarize': {
            'Displacement': ['mean']
          }
        }]
      });
    });
  });
});
