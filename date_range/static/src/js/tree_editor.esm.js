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
    const jsDate = deserializeDate(date);
    if (end && jsDate) {
        // Fix: Use standard Luxon .set() instead of accessing hidden obsolete properties (.c)
        const endOfDay = jsDate.set({
            hour: 23,
            minute: 59,
            second: 59,
            millisecond: 999
        });
        return serializeDateTime(endOfDay);
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
    const jsDateTime = deserializeDateTime(date);
    return serializeDate(jsDateTime);
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

        // env.domain is injected by the DomainSelector patch via useSubEnv
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

            // Odoo 20: Cleanly attach properties rather than double-patching structural configurations
            const originalExtractProps = info.extractProps ? info.extractProps.bind(info) : (p) => p;
            info.extractProps = function (props) {
                const extractedProps = originalExtractProps(...arguments);

                if (
                    fieldDef &&
                    (fieldDef.type === "date" || fieldDef.type === "datetime") &&
                    String(node.operator).includes("daterange")
                ) {
                    // Try to find the currently selected range
                    let selected = dateRanges.find(
                        (range) =>
                            range.date_start ===
                                fromDateTime(props.value?.[1], fieldDef.type) &&
                            range.date_end ===
                                fromDateTime(props.value?.[0], fieldDef.type)
                    );

                    // Fallback to the first available range
                    if (!selected && dateRanges.length) {
                        selected = dateRanges[0];
                        props.update([
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
                            props.update([
                                toDateTime(range.date_end, fieldDef.type),
                                toDateTime(range.date_start, fieldDef.type, true),
                            ]);
                        },
                        value: selected?.id ?? false,
                    };
                }
                return extractedProps;
            };

            const originalIsSupported = info.isSupported ? info.isSupported.bind(info) : () => true;
            info.isSupported = function (value) {
                if (String(node.operator).includes("daterange")) {
                    return Array.isArray(value) && value.length === 2;
                }
                return originalIsSupported(...arguments);
            };
        }

        return info;
    },

    getOperatorEditorInfo(node) {
        const info = super.getOperatorEditorInfo(...arguments);

        const originalIsSupported = info.isSupported ? info.isSupported.bind(info) : () => true;
        info.isSupported = function ([operator]) {
            if (String(node.operator).includes("daterange")) {
                return (
                    typeof operator === "string" &&
                    String(operator).includes("daterange")
                );
            }
            return originalIsSupported(...arguments);
        };

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
