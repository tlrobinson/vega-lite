import {Model} from '../Model';
import * as s from './';
import * as u from '../../util';
import {domain as scaleDomain, scaleType} from '../scale';
import {ScaleType} from '../../enums';

// TODO: Support ordinal scales.
export function parse(model: Model, sel: s.Selection) {
  sel.project = u.array(sel.domain);
  sel.project.forEach(function(channel, i) {
    var fieldDef = model.fieldDef(channel),
        scale  = model.scale(channel),
        type   = scaleType(scale, fieldDef, channel, model.mark()),
        domain = scaleDomain(scale, model, channel, type),
        fieldName = domain.field;

    if (type === ScaleType.ORDINAL) return;
    u.extend(scale, {
      domain: {
        data: s.storeName(sel),
        field: ['min_'+fieldName, 'max_'+fieldName]
      },
      clamp: false,
      zero: false,
      nice: false
    });

    sel.project[i] = {channel: channel, scaleType: type, field: fieldName};
  });
}

export function compileSignals(_, sel: s.Selection, trigger, clear) {
  // Domain initialized selections don't need any signals.
  trigger.name = clear.name = null;
}

export function compileData(_, sel: s.Selection, db) {
  var summarize = sel.project.reduce(function(obj, d) {
    return (obj[d.field] = ['min', 'max'], obj);
  }, {});

  db.source = 'source';  // TODO: should ref the enclosing unit's datasource.
  db.transform.push({ type: 'aggregate', summarize: summarize });
  db.modify.splice(0);   // Domain initialized selections don't need any modifiers.
}

