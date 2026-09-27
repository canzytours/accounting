/** @odoo-module **/

import {
    deserializeDate,
    deserializeDateTime,
    serializeDate,
    serializeDateTime,
} from "@web/core/l10n/dates";
import { Select } from "@web/core/tree_editor/tree_editor_components";
import { TreeEditor } from "@web/core/tree_editor/tree_editor";
import { patch } from "@web/core/utils/patch";

const { DateTime } = luxon;

/**
 * Convert a date (or datetime) value to the format expected by the domain.
 * When end === true and the field is datetime, set time to 23:59:59.
 */
function toDateTime(date, type, end = false) {
    if (type === "date") {
        return date;
    }
    let jsDate = deserializeDate(date);
    if (end) {
        jsDate = DateTime.fromObject({
            ...jsDate.c,
            hour: 23,
            minute: 59,
            second: 59,
        });
    }
    return serializeDateTime(jsDate);
}

/**
 * Convert a datetime value back to a pure date string (used for matching
 * against date.range records).
 */
function fromDateTime(date, type) {
    if (type === "date") {
        return date;
    }
    return serializeDate(deserializeDateTime(date));
}

patch(TreeEditor.prototype, {
    setup() {
        super.setup(...arguments);
        // Keep the last operator that was selected so we can filter ranges
        this.update_operator = null;
    },

    getValueEditorInfo(node) {
        const fieldDef = this.getFieldDef(node.path);
        const info = super.getValueEditorInfo(...arguments);

        // Only enhance date / datetime fields that use a daterange operator
        if (
            fieldDef &&
            (fieldDef.type === "date" || fieldDef.type === "datetime") &&
            String(node.operator).includes("daterange")
        ) {
            info.component = Select;
        }

        // env.domain is injected by the DomainSelector patch via useChildSubEnv
        if (this.env.domain) {
            let dateRanges = this.env.domain.dateRanges || [];

            // When a specific date-range type was chosen (daterange_<id>)
            // keep only ranges that belong to that type
            if (
                this.update_operator &&
                String(this.update_operator).includes("daterange_")
            ) {
                const typeId = Number(
                    String(this.update_operator).split("daterange_")[1]
                );
                dateRanges = dateRanges.filter(
                    (range) => range.type_id?.[0] === typeId
                );
            }

            patch(info, {
                extractProps({ value, update }) {
                    const props = super.extractProps(...arguments);

                    if (
                        fieldDef &&
                        (fieldDef.type === "date" || fieldDef.type === "datetime") &&
                        String(node.operator).includes("daterange")
                    ) {
                        // Try to find the currently selected range
                        let selected = dateRanges.find(
                            (range) =>
                                range.date_start ===
                                    fromDateTime(value?.[1], fieldDef.type) &&
                                range.date_end ===
                                    fromDateTime(value?.[0], fieldDef.type)
                        );

                        // Fallback to the first available range
                        if (!selected && dateRanges.length) {
                            selected = dateRanges[0];
                            update([
                                toDateTime(selected.date_end, fieldDef.type),
                                toDateTime(selected.date_start, fieldDef.type, true),
                            ]);
                        }

                        return {
                            options: dateRanges.map((dt) => [dt.id, dt.name]),
                            update: (v) => {
                                const range = dateRanges.find((r) => r.id === v);
                                if (!range) {
                                    return;
                                }
                                update([
                                    toDateTime(range.date_end, fieldDef.type),
                                    toDateTime(range.date_start, fieldDef.type, true),
                                ]);
                            },
                            value: selected?.id ?? false,
                        };
                    }
                    return props;
                },

                isSupported(value) {
                    if (String(node.operator).includes("daterange")) {
                        return Array.isArray(value) && value.length === 2;
                    }
                    return super.isSupported(...arguments);
                },
            });
        }

        return info;
    },

    getOperatorEditorInfo(node) {
        const info = super.getOperatorEditorInfo(...arguments);

        patch(info, {
            isSupported([operator]) {
                if (String(node.operator).includes("daterange")) {
                    return (
                        typeof operator === "string" &&
                        String(operator).includes("daterange")
                    );
                }
                return super.isSupported(...arguments);
            },
        });

        return info;
    },

    /**
     * Odoo 20 signature: updateLeafOperator(node, operator, negate)
     */
    updateLeafOperator(node, operator, negate) {
        super.updateLeafOperator(...arguments);

        this.update_operator = operator;
        const fieldDef = this.getFieldDef(node.path);

        if (this.env.domain && String(operator).includes("daterange")) {
            let dateRanges = this.env.domain.dateRanges || [];

            // Prefer ranges of the selected type
            const typeId = Number(String(operator).split("daterange_")[1]);
            if (typeId) {
                const filtered = dateRanges.filter(
                    (range) => range.type_id?.[0] === typeId
                );
                if (filtered.length) {
                    dateRanges = filtered;
                }
            }

            if (dateRanges.length && fieldDef) {
                node.value = [
                    toDateTime(dateRanges[0].date_end, fieldDef.type),
                    toDateTime(dateRanges[0].date_start, fieldDef.type, true),
                ];
                this.notifyChanges();
            }
        }
    },
});