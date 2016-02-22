import {SortOrder} from '../enums';
import {Aggregate} from '../aggregate';

export interface SortField {
  /**
   * The field name to aggregate over.
   */
  field: string;
  /**
   * The sort aggregation operator
   */
  op: Aggregate;

  order?: SortOrder;
}
