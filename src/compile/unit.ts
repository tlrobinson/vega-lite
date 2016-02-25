import {AggregateOp} from '../aggregate';
import {COLUMN, ROW, X, Y, COLOR, SHAPE, SIZE, TEXT, PATH, ORDER, Channel, CHANNELS, supportMark} from '../channel';
import {defaultConfig} from '../config';
import {SOURCE, SUMMARY} from '../data';
import * as vlEncoding from '../encoding'; // TODO: remove
import {FieldDef, FieldRefOption, field} from '../fielddef';
import {Mark, TEXT as TEXTMARK} from '../mark';
import {ScaleType} from '../scale';
import {SingleSpec} from '../spec';
import {getFullName, QUANTITATIVE} from '../type';
import {duplicate, extend, contains, mergeDeep} from '../util';
import {VgData} from '../vega.schema';

import {compileAxis} from './axis';
import {applyConfig, FILL_STROKE_CONFIG} from './common';
import {compileMarkConfig} from './config';
import {assembleData, compileUnitData} from './data';
import {compileLegends} from './legend';
import {assembleLayout, compileUnitLayout} from './layout';
import {Model} from './model';
import {compileMark} from './mark/mark';
import {compileScale, scaleType} from './scale';
import {compileStackProperties, StackProperties} from './stack';

/**
 * Internal model of Vega-Lite specification for the compiler.
 */
export class UnitModel extends Model {
  // TODO: decompose this into FacetModel
  private _spec: SingleSpec;
  private _stack: StackProperties;

  constructor(spec: SingleSpec) {
    super(spec);

    const model = this; // For self-reference in children method.

    this._spec = spec;

    const mark = this._spec.mark;

    // TODO: remove this || {}
    // Currently we have it to prevent null pointer exception.
    const encoding = this._spec.encoding = this._spec.encoding || {};
    const config = this._config = mergeDeep(duplicate(defaultConfig), spec.config);

    vlEncoding.forEach(this._spec.encoding, function(fieldDef: FieldDef, channel: Channel) {
      if (!supportMark(channel, this._spec.mark)) {
        // Drop unsupported channel

        // FIXME consolidate warning method
        console.warn(channel, 'dropped as it is incompatible with', this._spec.mark);
        delete this._spec.encoding[channel].field;
      }

      if (fieldDef.type) {
        // convert short type to full type
        fieldDef.type = getFullName(fieldDef.type);
      }

      if ((channel === PATH || channel === ORDER) && !fieldDef.aggregate && fieldDef.type === QUANTITATIVE) {
        fieldDef.aggregate = AggregateOp.MIN;
      }
    }, this);

    // Initialize Scale

    const scale = this._scale = [X, Y, COLOR, SHAPE, SIZE, ROW, COLUMN].reduce(function(_scale, channel) {
      // Position Axis
      if (vlEncoding.has(encoding, channel)) {
        const channelScale = encoding[channel].scale || {};
        const channelDef = encoding[channel];

        const _scaleType = scaleType(channelScale, channelDef, channel, mark);

        if (contains([ROW, COLUMN], channel)) {
            _scale[channel] = extend({
              type: _scaleType,
              round: config.facet.scale.round,
              padding: (channel === ROW && model.has(Y)) || (channel === COLUMN && model.has(X)) ?
                       config.facet.scale.padding : 0
            }, channelScale);
        } else {
          _scale[channel] = extend({
            type: _scaleType,
            round: config.scale.round,
            padding: config.scale.padding,
            includeRawDomain: config.scale.includeRawDomain,
            bandSize: channel === X && _scaleType === ScaleType.ORDINAL && mark === TEXTMARK ?
                       config.scale.textBandWidth : config.scale.bandSize
          }, channelScale);
        }
      }
      return _scale;
    }, {});

    // Initialize Axis
    this._axis = [X, Y, ROW, COLUMN].reduce(function(_axis, channel) {
      // Position Axis
      if (vlEncoding.has(encoding, channel)) {
        const channelAxis = encoding[channel].axis;
        if (channelAxis !== false) {
          _axis[channel] = extend({},
            channel === X || channel === Y ? config.axis : config.facet.axis,
            channelAxis === true ? {} : channelAxis ||  {}
          );
        }
      }
      return _axis;
    }, {});

    // initialize legend
    this._legend = [COLOR, SHAPE, SIZE].reduce(function(_legend, channel) {
      if (vlEncoding.has(encoding, channel)) {
        const channelLegend = encoding[channel].legend;
        if (channelLegend !== false) {
          _legend[channel] = extend({}, config.legend,
            channelLegend === true ? {} : channelLegend ||  {}
          );
        }
      }
      return _legend;
    }, {});

    // calculate stack
    this._stack = compileStackProperties(mark, encoding, scale, config);
    this._config.mark = compileMarkConfig(mark, encoding, config, this._stack);
  }

  public compileData() {
    this.component.data = compileUnitData(this);
  }

  public compileLayout() {
    this.component.layout = compileUnitLayout(this);
  }

  public compileScale() {
    this.component.scale = compileScale(this);
  }

  public compileMark() {
    this.component.mark = compileMark(this);
  }

  public compileAxis() {
    let axes: any = this.component.axis = {};
    if (this.has(X)) {
      axes.x = compileAxis(X, this);
    }
    if (this.has(Y)) {
      axes.y = compileAxis(Y, this);
    }
  }

  public compileLegend() {
    return compileLegends(this);
  }

  public assembleData(data: VgData[]): VgData[] {
    return assembleData(this, data);
  }

  public assembleLayout(layoutData: VgData[]): VgData[] {
    return assembleLayout(this, layoutData);
  }

  public assembleMarks() {
    return this.component.mark;
  }

  public assembleGroupProperties() {
    // FIXME need to think how this works with facet
    return applyConfig({}, this.config().cell, FILL_STROKE_CONFIG.concat(['clip']));
  }

  public channels() {
    return CHANNELS;
  }

  protected mapping() {
    return this.encoding();
  }

  public stack(): StackProperties {
    return this._stack;
  }

  public toSpec(excludeConfig?, excludeData?) {
    const encoding = duplicate(this._spec.encoding);
    let spec: any;

    spec = {
      mark: this._spec.mark,
      encoding: encoding
    };

    if (!excludeConfig) {
      spec.config = duplicate(this._spec.config);
    }

    if (!excludeData) {
      spec.data = duplicate(this._spec.data);
    }

    // remove defaults
    return spec;
  }

  // TODO: remove
  public cellWidth(): number {
    return (this.isFacet() ? this.config().facet.cell.width : null) ||
      this.config().cell.width;
  }

  // TODO: remove
  public cellHeight(): number {
    return (this.isFacet() ? this.config().facet.cell.height : null) ||
      this.config().cell.height;
  }

  public mark(): Mark {
    return this._spec.mark;
  }

  public has(channel: Channel) {
    return vlEncoding.has(this._spec.encoding, channel);
  }

  public encoding() {
    return this._spec.encoding;
  }

  public fieldDef(channel: Channel): FieldDef {
    // TODO: remove this || {}
    // Currently we have it to prevent null pointer exception.
    return this._spec.encoding[channel] || {};
  }

  /** Get "field" reference for vega */
  public field(channel: Channel, opt: FieldRefOption = {}) {
    const fieldDef = this.fieldDef(channel);

    if (fieldDef.bin) { // bin has default suffix that depends on scaleType
      opt = extend({
        binSuffix: this.scale(channel).type === ScaleType.ORDINAL ? '_range' : '_start'
      }, opt);
    }

    return field(fieldDef, opt);
  }

  // TODO: remove
  public isFacet() {
    return this.has(ROW) || this.has(COLUMN);
  }

  public dataTable() {
    return vlEncoding.isAggregate(this._spec.encoding) ? SUMMARY : SOURCE;
  }

}
