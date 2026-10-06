import { Component, onMounted, onWillStart, proxy } from "@odoo/owl";
import { useBus, useService } from "@web/core/utils/hooks";
import { DateTimeInput } from "@web/core/datetime/datetime_input";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { SearchModel } from "@web/search/search_model";
import { parseDate } from "@web/core/l10n/dates";
import { registry } from "@web/core/registry";
import { AnnotationDialog } from "../annotation_dialog/annotation_dialog.esm";
import { _t } from "@web/core/l10n/translation";

export class MisReportWidget extends Component {
    static components = { SearchBar, DateTimeInput };
    static template = "mis_builder.MisReportWidget";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.view = useService("view");
        this.dialog = useService("dialog");
        this.JSON = JSON;

        // OWL 3: useState removed → proxy
        this.state = proxy({
            mis_report_data: { header: [], body: [], notes: {} },
            pivot_date: null,
            can_edit_annotation: false,
            can_read_annotation: false,
        });

        this.searchModel = new SearchModel(this.env, {
            orm: this.orm,
            view: this.view,
            dialog: this.dialog,
        });

        // OWL 3: env is read-only. Use compatibility layer useSubEnv if available.
        // Do NOT do: this.env.searchModel = ...
        const useSubEnv = globalThis.owl?.useSubEnv;
        if (typeof useSubEnv === "function") {
            useSubEnv({ searchModel: this.searchModel });
        }

        useBus(this.searchModel, "update", async () => {
            await this.searchModel.sectionsPromise;
            this.refresh();
        });

        onWillStart(this.willStart.bind(this));
        onMounted(this._onMounted.bind(this));
    }

    async willStart() {
        const instanceId = this._instanceId();
        if (!instanceId) {
            return;
        }

        const [result] = await this.orm.read(
            "mis.report.instance",
            [instanceId],
            [
                "source_aml_model_name",
                "widget_show_filters",
                "widget_show_settings_button",
                "widget_search_view_id",
                "pivot_date",
                "widget_show_pivot_date",
                "wide_display_by_default",
                "user_can_read_annotation",
                "user_can_edit_annotation",
            ],
            { context: this.context }
        );

        if (!result) {
            return;
        }

        this.source_aml_model_name = result.source_aml_model_name;
        this.widget_show_filters = result.widget_show_filters;
        this.widget_show_settings_button = result.widget_show_settings_button;
        this.widget_search_view_id = result.widget_search_view_id?.[0];

        this.state.pivot_date = result.pivot_date
            ? parseDate(result.pivot_date)
            : null;

        this.widget_show_pivot_date = result.widget_show_pivot_date;

        if (this.showSearchBar) {
            await this.searchModel.load({
                resModel: this.source_aml_model_name,
                searchViewId: this.widget_search_view_id,
            });
        }

        this.wide_display = result.wide_display_by_default;

        await this.refresh();

        this.state.can_edit_annotation = result.user_can_edit_annotation;
        this.state.can_read_annotation = result.user_can_read_annotation;
    }

    async _onMounted() {
        this.resize_sheet();
    }

    get showSearchBar() {
        // Only show filters when we could inject searchModel into env
        const hasSubEnv = typeof globalThis.owl?.useSubEnv === "function";
        return (
            hasSubEnv &&
            this.source_aml_model_name &&
            this.widget_show_filters &&
            this.widget_search_view_id
        );
    }

    get showPivotDate() {
        return this.widget_show_pivot_date;
    }

    /**
     * Resolve the MIS report instance ID.
     * Odoo 19/20 field widgets no longer receive props.value.
     */
    _instanceId() {
        if (this.props.record?.resId) {
            return this.props.record.resId;
        }
        if (this.props.value) {
            return this.props.value;
        }
        const recordContext = this.props.record?.context || {};
        if (recordContext.active_model === "mis.report.instance") {
            return recordContext.active_id;
        }
        return null;
    }

    get context() {
        const recordContext = this.props.record?.context || {};
        return {
            ...recordContext,
            ...(this.showSearchBar && {
                mis_analytic_domain: this.searchModel.searchDomain,
            }),
            ...(this.showPivotDate &&
                this.state.pivot_date && {
                    mis_pivot_date: this.state.pivot_date,
                }),
        };
    }

    async drilldown(event) {
        const drilldown = JSON.parse(event.target.dataset.drilldown);
        const action = await this.orm.call(
            "mis.report.instance",
            "drilldown",
            [this._instanceId(), drilldown],
            { context: this.context }
        );
        this.action.doAction(action);
    }

    async refresh() {
        const instanceId = this._instanceId();
        if (!instanceId) {
            return;
        }
        this.state.mis_report_data = await this.orm.call(
            "mis.report.instance",
            "compute",
            [instanceId],
            { context: this.context }
        );
    }

    async refresh_annotation() {
        const instanceId = this._instanceId();
        if (!instanceId) {
            return;
        }
        this.state.mis_report_data.notes = await this.orm.call(
            "mis.report.instance.annotation",
            "get_notes_by_cell_id",
            [instanceId],
            { context: this.context }
        );
    }

    async printPdf() {
        const action = await this.orm.call(
            "mis.report.instance",
            "print_pdf",
            [this._instanceId()],
            { context: this.context }
        );
        this.action.doAction(action);
    }

    async exportXls() {
        const action = await this.orm.call(
            "mis.report.instance",
            "export_xls",
            [this._instanceId()],
            { context: this.context }
        );
        this.action.doAction(action);
    }

    async displaySettings() {
        const action = await this.orm.call(
            "mis.report.instance",
            "display_settings",
            [this._instanceId()],
            { context: this.context }
        );
        this.action.doAction(action);
    }

    async _remove_annotation(cell_id) {
        await this.orm.call(
            "mis.report.instance.annotation",
            "remove_annotation",
            [cell_id, this._instanceId()],
            { context: this.context }
        );
        await this.refresh_annotation();
    }

    async _save_annotation(cell_id, text) {
        await this.orm.call(
            "mis.report.instance.annotation",
            "set_annotation",
            [cell_id, this._instanceId(), text],
            { context: this.context }
        );
        await this.refresh_annotation();
    }

    async annotate(event) {
        const cell_id = event.target.dataset.cellId;
        const note = this.state.mis_report_data.notes[cell_id];
        const note_text = (note && note.text) || "";
        this.dialog.add(AnnotationDialog, {
            title: _t("Annotate"),
            annotationText: note_text,
            confirm: async (text) => {
                await this._save_annotation(cell_id, text);
            },
            canRemove: typeof note !== "undefined",
            remove: async () => {
                await this._remove_annotation(cell_id);
            },
        });
    }

    async remove_annotation(event) {
        const cell_id = event.target.dataset.cellId;
        await this._remove_annotation(cell_id);
    }

    onDateTimeChanged(ev) {
        this.state.pivot_date = ev;
        this.refresh();
    }

    async toggle_wide_display() {
        this.wide_display = !this.wide_display;
        this.resize_sheet();
    }

    async resize_sheet() {
        const sheetElement = document.querySelector(".o_form_sheet_bg");
        if (sheetElement) {
            sheetElement.classList.toggle(
                "oe_mis_builder_report_wide_sheet",
                !!this.wide_display
            );
        }
        const buttonResizeElement = document.getElementById("icon_resize");
        if (buttonResizeElement) {
            buttonResizeElement.classList.toggle("fa-expand", !this.wide_display);
            buttonResizeElement.classList.toggle("fa-compress", !!this.wide_display);
        }
    }
}

export const misReportWidget = {
    component: MisReportWidget,
};

registry.category("fields").add("mis_report_widget", misReportWidget);