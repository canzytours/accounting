/** @odoo-module **/

import { domainFromTreeDateRange, treeFromDomainDateRange } from "./condition_tree.esm";

import { onWillStart, useSubEnv } from "@odoo/owl";
import { Domain } from "@web/core/domain";
import { DomainSelector } from "@web/core/domain_selector/domain_selector";
import { useService } from "@web/core/utils/hooks";
import { patch } from "@web/core/utils/patch";

const ARCHIVED_DOMAIN = `[("active", "in", [True, False])]`;

patch(DomainSelector.prototype, {
    setup() {
        super.setup(...arguments);
        this.orm = useService("orm");
        this.dateRanges = [];
        this.dateRangeTypes = [];
        useSubEnv({ domain: this });
        onWillStart(async () => {
            // Load all date ranges and types once (same behaviour as 19.0)
            this.dateRanges = await this.orm.call("date.range", "search_read", [], {
                fields: ["id", "name", "type_id", "date_start", "date_end"],
            });
            this.dateRangeTypes = await this.orm.call(
                "date.range.type",
                "search_read",
                [],
                {
                    fields: ["id", "name", "date_ranges_exist"],
                }
            );
        });
    },

    /**
     * Override to inject date-range aware tree conversion after the core
     * DomainSelector has built the tree.
     */
    async onPropsUpdated(p) {
        // Let core DomainSelector process the domain first
        await super.onPropsUpdated(...arguments);

        if (this.tree) {
            try {
                const domain = new Domain(p.domain);
                this.tree = treeFromDomainDateRange(domain, {
                    distributeNot: !p.isDebugMode,
                });
            } catch (error) {
                // Keep the original tree if our conversion fails
                console.warn("Date range domain processing failed:", error);
            }
        }
    },

    getOperatorEditorInfo(fieldDef) {
        const info = super.getOperatorEditorInfo(fieldDef);
        const dateRanges = this.dateRanges;
        const dateRangeTypes = this.dateRangeTypes.filter(
            (dt) => dt.date_ranges_exist
        );

        // Patch the operator editor so it offers "daterange" and
        // "in <Date Range Type>" operators for date / datetime fields
        patch(info, {
            extractProps({ value: [operator] }) {
                const props = super.extractProps(...arguments);
                const isDateField =
                    fieldDef &&
                    (fieldDef.type === "date" || fieldDef.type === "datetime");
                const hasDateRanges = isDateField && dateRanges.length;
                const hasDateRangeTypes = isDateField && dateRangeTypes.length;

                if (hasDateRanges) {
                    // Avoid duplicate "daterange" entry
                    if (operator && String(operator).includes("daterange")) {
                        props.options.pop();
                    }
                    if (operator === "daterange") {
                        props.value = "daterange";
                    }
                    props.options.push(["daterange", "daterange"]);
                }

                if (hasDateRangeTypes) {
                    const selectedDateRange = dateRangeTypes.find(
                        (rangeType) =>
                            rangeType.id ===
                            Number(String(operator).split("daterange_")[1])
                    );

                    if (selectedDateRange) {
                        props.value = operator;
                    }

                    props.options.push(
                        ...dateRangeTypes.map((rangeType) => [
                            `daterange_${rangeType.id}`,
                            `in ${rangeType.name}`,
                        ])
                    );
                }

                return props;
            },
        });

        return info;
    },

    /**
     * Convert the internal tree back to a domain string,
     * expanding any date-range operators and handling the archived checkbox.
     */
    update(tree) {
        const archiveDomain = this.includeArchived ? ARCHIVED_DOMAIN : `[]`;
        const domain = tree
            ? Domain.and([
                  domainFromTreeDateRange(tree),
                  archiveDomain,
              ]).toString()
            : archiveDomain;
        this.props.update(domain);
    },
});