/** @odoo-module **/

import {
    condition,
    connector,
    formatValue,
    normalizeValue,
} from "@web/core/tree_editor/condition_tree";
import { domainFromTree } from "@web/core/tree_editor/domain_from_tree";
import { treeFromDomain } from "@web/core/tree_editor/tree_from_domain";

/**
 * Helper: merge a child into a parent connector when they share the same
 * non-negated operator (same logic as core tree_editor).
 */
function addChild(parent, child) {
    if (child.type === "connector" && !child.negate && child.value === parent.value) {
        parent.children.push(...child.children);
    } else {
        parent.children.push(child);
    }
}

/**
 * Expand any "daterange*" operators back into classic <= / >= pairs
 * so the core domainFromTree can produce a valid domain.
 */
export function removeDateRangeOperators(tree) {
    if (tree.type === "complex_condition") {
        return tree;
    }
    if (tree.type === "condition") {
        if (!String(tree.operator).includes("daterange")) {
            return tree;
        }
        const { negate, path, value } = tree;
        // value is expected to be [date_start, date_end]
        return connector(
            "&",
            [
                condition(path, "<=", value[0]),
                condition(path, ">=", value[1]),
            ],
            negate
        );
    }
    const processedChildren = tree.children.map(removeDateRangeOperators);
    if (tree.value === "|") {
        return { ...tree, children: processedChildren };
    }
    // Normalize consecutive "&" connectors
    const newTree = { ...tree, children: [] };
    for (const child of processedChildren) {
        addChild(newTree, child);
    }
    return newTree;
}

/**
 * Collapse consecutive <= / >= pairs that share the same path into a single
 * "daterange" (or "daterange_<type_id>") operator.
 */
function createDateRangeOperators(tree) {
    if (["condition", "complex_condition"].includes(tree.type)) {
        return tree;
    }

    const processedChildren = tree.children.map(createDateRangeOperators);

    if (tree.value === "|") {
        return { ...tree, children: processedChildren };
    }

    const children = [];
    let operator = "daterange";

    // Safe isolated check: Only read selects that explicitly belong to the domain tree editor UI
    const selects = document.getElementsByTagName("select");
    if (selects.length) {
        const domainSelect = Array.from(selects).find(s =>
            s.closest('.o_domain_selector') ||
            s.closest('.o_tree_editor') ||
            s.classList.contains('o_domain_leaf_operator_select')
        );

        if (domainSelect) {
            const selected = domainSelect.selectedOptions?.[0];
            if (selected) {
                operator = selected.value.replace(/^"|"$/g, "");
            }
        }
    }

    for (let i = 0; i < processedChildren.length; i++) {
        const child1 = processedChildren[i];
        const child2 = processedChildren[i + 1];

        if (
            child1.type === "condition" &&
            child2 &&
            child2.type === "condition" &&
            formatValue(child1.path) === formatValue(child2.path) &&
            child1.operator === "<=" &&
            child2.operator === ">="
        ) {
            children.push(
                condition(
                    child1.path,
                    operator,
                    normalizeValue([child1.value, child2.value])
                )
            );
            i += 1; // skip the second child
        } else {
            children.push(child1);
        }
    }

    if (children.length === 1) {
        return { ...children[0] };
    }
    return { ...tree, children };
}

/**
 * Convert a date-range-aware tree into a classic domain string.
 */
export function domainFromTreeDateRange(tree) {
    return domainFromTree(removeDateRangeOperators(tree));
}

/**
 * Convert a domain into a date-range-aware tree
 * (collapses <= / >= pairs into daterange operators).
 */
export function treeFromDomainDateRange(domain, options = {}) {
    return createDateRangeOperators(treeFromDomain(domain, options));
}
