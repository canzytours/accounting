import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class AnnotationDialog extends Component {
    static components = { Dialog };
    static props = {
        close: Function,
        annotationText: { type: String, optional: true },
        confirm: { type: Function },
        title: { type: String, optional: true },
        remove: { type: Function },
        canRemove: { type: Boolean, optional: true },
    };
    static template = "mis_builder.AnnotationDialog";

    setup() {
        this.state = useState({
            annotationText: this.props.annotationText || "",
        });
    }

    confirm() {
        this.props.confirm(this.state.annotationText);
        this.props.close();
    }

    remove() {
        this.props.remove();
        this.props.close();
    }
}