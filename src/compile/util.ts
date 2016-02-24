import {Model} from './Model';
import {FieldDef, OrderChannelDef} from '../schema/fielddef.schema';
import {COLUMN, ROW, X, Y, SIZE, COLOR, SHAPE, TEXT, LABEL, Channel} from '../channel';
import {field} from '../fielddef';
import {QUANTITATIVE, ORDINAL, TEMPORAL} from '../type';
import {format as timeFormatExpr} from './time';
import {contains} from '../util';
import {SortOrder} from '../enums';
import {compileProductionRule} from './rule';

export const FILL_STROKE_CONFIG = ['fill', 'fillOpacity',
  'stroke', 'strokeWidth', 'strokeDash', 'strokeDashOffset', 'strokeOpacity',
  'opacity'];

export function applyColorAndOpacity(p, model: Model) {
  const filled = model.config().mark.filled;

  // Apply fill stroke config first so that color field / value can override
  // fill / stroke
  applyMarkConfig(p, model, FILL_STROKE_CONFIG);

  const property = filled ? 'fill' : 'stroke';
  compileProductionRule(model, COLOR, p, function(fieldDef) {
    var prop = {};
    if (fieldDef.field) {
      prop[property] = {
        scale: model.scaleName(COLOR),
        field: model.field(COLOR, fieldDef.type === ORDINAL ? { prefn: 'rank_' } : {}, fieldDef)
      }
    } else if (fieldDef.value) {
      prop[property] = { value: fieldDef.value };
    } else {
      prop[property] = { value: model.config().mark.color };
    }
    return prop;
  });
}

export function applyConfig(properties, config, propsList: string[]) {
  propsList.forEach(function(property) {
    const value = config[property];
    if (value !== undefined) {
      properties[property] = { value: value };
    }
  });
}

export function applyMarkConfig(marksProperties, model: Model, propsList: string[]) {
  applyConfig(marksProperties, model.config().mark, propsList);
}


/**
 * Builds an object with format and formatType properties.
 *
 * @param format explicitly specified format
 */
export function formatMixins(model: Model, channel: Channel, format: string) {
  const fieldDef = model.fieldDef(channel);

  if(!contains([QUANTITATIVE, TEMPORAL], fieldDef.type)) {
    return {};
  }

  let def: any = {};

  if (fieldDef.type === TEMPORAL) {
    def.formatType = 'time';
  }

  if (format !== undefined) {
    def.format = format;
  } else {
    switch (fieldDef.type) {
      case QUANTITATIVE:
        def.format = model.config().numberFormat;
        break;
      case TEMPORAL:
        def.format = timeFormat(model, channel) || model.config().timeFormat;
        break;
    }
  }

  if (channel === TEXT) {
    // text does not support format and formatType
    // https://github.com/vega/vega/issues/505

    const filter = (def.formatType || 'number') + (def.format ? ':\'' + def.format + '\'' : '');
    return {
      text: {
        template: '{{' + model.field(channel, { datum: true }) + ' | ' + filter + '}}'
      }
    };
  }

  return def;
}

function isAbbreviated(model: Model, channel: Channel, fieldDef: FieldDef) {
  switch (channel) {
    case ROW:
    case COLUMN:
    case X:
    case Y:
      return model.axis(channel).shortTimeLabels;
    case COLOR:
    case SHAPE:
    case SIZE:
      return model.legend(channel).shortTimeLabels;
    case TEXT:
      return model.config().mark.shortTimeLabels;
    case LABEL:
      // TODO(#897): implement when we have label
  }
  return false;
}



/** Return field reference with potential "-" prefix for descending sort */
export function sortField(orderChannelDef: OrderChannelDef) {
  return (orderChannelDef.sort === SortOrder.DESCENDING ? '-' : '') + field(orderChannelDef);
}

/**
 * Returns the time format used for axis labels for a time unit.
 */
export function timeFormat(model: Model, channel: Channel): string {
  const fieldDef = model.fieldDef(channel);
  return timeFormatExpr(fieldDef.timeUnit, isAbbreviated(model, channel, fieldDef));
}
