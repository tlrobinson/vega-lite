import {AxisProperties} from '../axis';
import {Channel} from '../channel';
import {Config} from '../config';
import {Data} from '../data';
import {channelMappingReduce, channelMappingForEach} from '../encoding';
import {FieldDef, FieldRefOption, field} from '../fielddef';
import {LegendProperties} from '../legend';
import {Scale, ScaleType} from '../scale';
import {BaseSpec} from '../spec';
import {Transform} from '../transform';
import {extend, vals} from '../util';
import {VgData, VgMarkGroup, VgScale, VgAxis} from '../vega.schema';

import {DataComponent} from './data';
import {FacetModel} from './facet';
import {LayoutComponent} from './layout';
import {LegendComponentMap} from './legend';
import {ScaleComponentMap} from './scale';
import {UnitModel} from './unit';

// FIXME remove this
export interface ScaleMap {
  x?: Scale;
  y?: Scale;
  row?: Scale;
  column?: Scale;
  color?: Scale;
  size?: Scale;
  shape?: Scale;
};

export function buildModel(spec): Model {
  if ('facet' in spec) {
    return new FacetModel(spec);
  }
  return new UnitModel(spec);
}

export interface Component {
  data: DataComponent;
  layout: LayoutComponent;
  mark: VgMarkGroup[];
  scale: ScaleComponentMap;
  axis: any; // FIXME:
  legend: LegendComponentMap;
}

export abstract class Model {
  protected _name: string;
  protected _description: string;

  protected _data: Data;
  protected _dataName: {[dataSourceType: string] :string};

  protected _transform: Transform;
  protected _scale: ScaleMap;

  protected _axis: {
    x?: AxisProperties;
    y?: AxisProperties;
    row?: AxisProperties;
    column?: AxisProperties;
  };

  protected _legend: {
    color?: LegendProperties;
    size?: LegendProperties;
    shape?: LegendProperties;
  };

  protected _config: Config;

  // HACK this is protected in Java sense but TS is acting weird if I set this to protected
  public component: Component;

  constructor(spec: BaseSpec) {
    this._name = spec.name;

    this._data = spec.data;
    this._dataName = {};

    this._description = spec.description;
    this._transform = spec.transform;

    this.component = {data: null, layout: null, mark: null, scale: null, axis: null, legend: null};
  }

  public abstract compileData();

  public abstract compileLayout();

  public abstract compileScale();

  public abstract compileMark();

  public abstract compileAxis();

  public abstract compileLegend();

  public compile() {
    this.compileData();
    this.compileLayout();
    this.compileScale();
    this.compileMark();
    this.compileAxis();
    this.compileLegend();
  }

  public abstract assembleData(data: VgData[]): VgData[];

  public abstract assembleLayout(layoutData: VgData[]): VgData[];

  public assembleScales(): VgScale[] {
    // FIXME: this should help assemble scale domains with scale signature as well
    return vals(this.component.scale);
  }

  public abstract assembleMarks(): any[]; // TODO: VgMarkGroup[]

  public assembleAxes(): VgAxis[] {
    return vals(this.component.axis);
  }

  public assembleLegends(): any[] { // TODO: VgLegend[]
    return vals(this.component.legend);
  }

  public assembleGroup() {
    let group: any = {}; // TODO: VgGroup
    group.marks = this.assembleMarks();
    const scales = this.assembleScales();
    if (scales.length > 0) {
      group.scales = scales;
    }

    const axes = this.assembleAxes();
    if (axes.length > 0) {
      group.axes = axes;
    }

    const legends = this.assembleLegends();
    if (legends.length > 0) {
      group.legends = legends;
    }

    return group;
  }

  public abstract assembleGroupProperties();

  public abstract channels(): Channel[];

  protected abstract mapping();

  public reduce(f: (acc: any, fd: FieldDef, c: Channel) => any, init, t?: any) {
    return channelMappingReduce(this.channels(), this.mapping(), f, init, t);
  }

  public forEach(f: (fd: FieldDef, c: Channel, i:number) => void, t?: any) {
    channelMappingForEach(this.channels(), this.mapping(), f, t);
  }

  public abstract has(channel: Channel): boolean;

  public name(text: string) {
    return (name ? name + '-' : '') + text;
  }

  public description() {
    return this._description;
  }

  public data() {
    return this._data;
  }

  public abstract dataTable(): string;

  public transform() {
    return this._transform || {};
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

  public abstract fieldDef(channel: Channel): FieldDef;

  public scale(channel: Channel): Scale {
    return this._scale[channel];
  }

  public isOrdinalScale(channel: Channel) {
    return this.scale(channel).type === ScaleType.ORDINAL;
  }

  /** returns scale name for a given channel */
  public scaleName(channel: Channel|string): string {
    const name = this._name;
    return (name ? name + '-' : '') + channel;
  }

  public sort(channel: Channel) {
    return (this.mapping()[channel] || {}).sort;
  }

  public abstract stack();

  public axis(channel: Channel): AxisProperties {
    return this._axis[channel];
  }

  public legend(channel: Channel): LegendProperties {
    return this._legend[channel];
  }

  /**
   * Get the spec configuration.
   */
  public config() {
    return this._config;
  }
}
