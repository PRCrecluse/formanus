declare module 'react-contenteditable' {
    import * as React from 'react';

    export interface ContentEditableEvent {
        target: {
            value: string;
        };
    }

    export interface Props extends React.HTMLAttributes<HTMLElement> {
        html: string;
        disabled?: boolean;
        tagName?: string;
        className?: string;
        style?: React.CSSProperties;
        innerRef?: React.RefObject<HTMLElement | null> | ((e: HTMLElement | null) => void);
        onChange?: (event: ContentEditableEvent) => void;
        onBlur?: (event: React.FocusEvent<HTMLElement>) => void;
        onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
        onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
        placeholder?: string;
    }

    const ContentEditable: React.FC<Props>;
    export default ContentEditable;
}
