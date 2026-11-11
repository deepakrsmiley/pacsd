import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Clipboard,
  ClipboardPaste,
  FileSignature,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  List,
  ListOrdered,
  Mic,
  Minus,
  Outdent,
  Paintbrush,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  Save,
  Search,
  Square,
  Strikethrough,
  Upload,
  Subscript,
  Superscript,
  Table2,
  Type,
  Underline,
  Undo2,
  WrapText,
} from "lucide-react";
import { FIELD_DEFS } from "../../../shared/reportDocument.js";
import { DICTATION_LANGUAGES } from "./dictation.js";
import { changeIndent, clearFormatting, copyFormat, currentFontSize, startFormatPainter } from "./extensions/tools.js";
import {
  ColorGrid,
  DropButton,
  HIGHLIGHT_COLORS,
  MenuItem,
  MenuLabel,
  RibbonButton,
  RibbonGroup,
  Row,
  Stack,
  THEME_COLORS,
} from "./ui.jsx";

const FONTS = ["Calibri", "Cambria", "Arial", "Times New Roman", "Georgia", "Verdana", "Tahoma", "Courier New"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
const LINE_SPACING = [["1.0", 1], ["1.15", 1.15], ["1.5", 1.5], ["2.0", 2]];

function keep(event) {
  if (event.target.closest("input, select, textarea")) return;
  event.preventDefault();
}

export default function Ribbon({ editor, readOnly, tab, onTab, dictation, onDialog, onPanel }) {
  const disabled = readOnly || !editor;
  const family = editor?.getAttributes("textStyle").fontFamily || "Calibri";
  const size = editor ? String(currentFontSize(editor)) : "11";
  const run = (command) => {
    if (disabled) return;
    command();
  };
  return (
    <div className="we-ribbon">
      <div className="flex h-8 items-end gap-1 px-2">
        {[["home", "Home"], ["insert", "Insert"]].map(([key, label]) => (
          <button key={key} type="button" className={`h-7 border-b-2 px-3 text-[12.5px] ${tab === key ? "border-[#7c3aed] font-semibold text-[#7c3aed]" : "border-transparent text-[#48484a]"}`} onMouseDown={keep} onClick={() => onTab(key)}>{label}</button>
        ))}
      </div>
      <div className="we-ribbon-scroll">
        {tab === "home" ? (
          <>
            <RibbonGroup label="Clipboard">
              <Stack>
                <RibbonButton icon={ClipboardPaste} label="Paste" showLabel disabled={disabled} onClick={() => onDialog("paste")} />
                <Row>
                  <RibbonButton icon={Clipboard} label="Copy" disabled={disabled} onClick={() => document.execCommand("copy")} />
                  <RibbonButton icon={Paintbrush} label="Format painter" disabled={disabled} onClick={() => { copyFormat(editor); startFormatPainter(editor); }} shortcut="Ctrl+Shift+C" />
                </Row>
              </Stack>
            </RibbonGroup>
            <RibbonGroup label="Font">
              <Stack>
                <Row>
                  <select className="we-input h-[26px] w-[132px]" aria-label="Font family" disabled={disabled} value={FONTS.includes(family) ? family : "Calibri"} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => run(() => editor.chain().focus().setFontFamily(event.target.value).run())}>
                    {FONTS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className="we-input h-[26px] w-[64px]" aria-label="Font size" disabled={disabled} value={SIZES.includes(Number(size)) ? String(Number(size)) : "11"} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => run(() => editor.chain().focus().setFontSize(`${event.target.value}pt`).run())}>
                    {SIZES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Row>
                <Row>
                  <RibbonButton icon={Bold} label="Bold" shortcut="Ctrl+B" disabled={disabled} active={editor?.isActive("bold")} onClick={() => run(() => editor.chain().focus().toggleBold().run())} />
                  <RibbonButton icon={Italic} label="Italic" shortcut="Ctrl+I" disabled={disabled} active={editor?.isActive("italic")} onClick={() => run(() => editor.chain().focus().toggleItalic().run())} />
                  <RibbonButton icon={Underline} label="Underline" shortcut="Ctrl+U" disabled={disabled} active={editor?.isActive("underline")} onClick={() => run(() => editor.chain().focus().toggleUnderline().run())} />
                  <RibbonButton icon={Strikethrough} label="Strikethrough" disabled={disabled} active={editor?.isActive("strike")} onClick={() => run(() => editor.chain().focus().toggleStrike().run())} />
                  <DropButton icon={Type} label="Font colour" swatch={editor?.getAttributes("textStyle").color} disabled={disabled} width={220}>
                    {(close) => <ColorGrid colors={THEME_COLORS} onPick={(color) => { editor.chain().focus().setColor(color).run(); close(); }} onAutomatic={() => { editor.chain().focus().unsetColor().run(); close(); }} />}
                  </DropButton>
                  <DropButton icon={Highlighter} label="Highlight" disabled={disabled} width={220}>
                    {(close) => <ColorGrid colors={HIGHLIGHT_COLORS} custom={false} onPick={(color) => { editor.chain().focus().toggleHighlight({ color }).run(); close(); }} onAutomatic={() => { editor.chain().focus().unsetHighlight().run(); close(); }} automaticLabel="No colour" />}
                  </DropButton>
                  <RibbonButton icon={Subscript} label="Subscript" disabled={disabled} active={editor?.isActive("subscript")} onClick={() => run(() => editor.chain().focus().toggleSubscript().run())} />
                  <RibbonButton icon={Superscript} label="Superscript" disabled={disabled} active={editor?.isActive("superscript")} onClick={() => run(() => editor.chain().focus().toggleSuperscript().run())} />
                  <RibbonButton icon={RemoveFormatting} label="Clear formatting" disabled={disabled} onClick={() => run(() => clearFormatting(editor))} />
                </Row>
              </Stack>
            </RibbonGroup>
            <RibbonGroup label="Paragraph">
              <Stack>
                <Row>
                  <RibbonButton icon={List} label="Bullets" disabled={disabled} active={editor?.isActive("bulletList")} onClick={() => run(() => editor.chain().focus().toggleBulletList().run())} />
                  <RibbonButton icon={ListOrdered} label="Numbering" disabled={disabled} active={editor?.isActive("orderedList")} onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())} />
                  <RibbonButton icon={Outdent} label="Decrease indent" disabled={disabled} onClick={() => run(() => changeIndent(editor, -1))} />
                  <RibbonButton icon={Indent} label="Increase indent" disabled={disabled} onClick={() => run(() => changeIndent(editor, 1))} />
                  <DropButton icon={WrapText} label="Line spacing" disabled={disabled} width={180}>
                    {(close) => (
                      <>
                        <MenuLabel>Line spacing</MenuLabel>
                        {LINE_SPACING.map(([label, value]) => <MenuItem key={label} label={label} onClick={() => { editor.chain().focus().setParagraphFormat({ lineHeight: value }).run(); close(); }} />)}
                        <MenuLabel>Space after</MenuLabel>
                        {[0, 6, 8, 12].map((value) => <MenuItem key={value} label={`${value} pt`} onClick={() => { editor.chain().focus().setParagraphFormat({ spaceAfter: value }).run(); close(); }} />)}
                      </>
                    )}
                  </DropButton>
                </Row>
                <Row>
                  <RibbonButton icon={AlignLeft} label="Align left" disabled={disabled} active={editor?.isActive({ textAlign: "left" })} onClick={() => run(() => editor.chain().focus().setTextAlign("left").run())} />
                  <RibbonButton icon={AlignCenter} label="Align centre" disabled={disabled} active={editor?.isActive({ textAlign: "center" })} onClick={() => run(() => editor.chain().focus().setTextAlign("center").run())} />
                  <RibbonButton icon={AlignRight} label="Align right" disabled={disabled} active={editor?.isActive({ textAlign: "right" })} onClick={() => run(() => editor.chain().focus().setTextAlign("right").run())} />
                  <RibbonButton icon={AlignJustify} label="Justify" disabled={disabled} active={editor?.isActive({ textAlign: "justify" })} onClick={() => run(() => editor.chain().focus().setTextAlign("justify").run())} />
                  <RibbonButton icon={Pilcrow} label="Paragraph spacing" disabled={disabled} onClick={() => onDialog("paragraph")} />
                </Row>
              </Stack>
            </RibbonGroup>
            <RibbonGroup label="Editing">
              <Stack>
                <Row>
                  <RibbonButton icon={Undo2} label="Undo" shortcut="Ctrl+Z" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
                  <RibbonButton icon={Redo2} label="Redo" shortcut="Ctrl+Y" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
                </Row>
                <Row>
                  <RibbonButton icon={Search} label="Find" showLabel shortcut="Ctrl+F" onClick={() => onPanel("find")} />
                  <RibbonButton icon={Square} label="Select all" disabled={disabled} onClick={() => editor.chain().focus().selectAll().run()} />
                </Row>
              </Stack>
            </RibbonGroup>
          </>
        ) : (
          <>
            <RibbonGroup label="Tables and pages">
              <RibbonButton icon={Table2} label="Table" showLabel large disabled={disabled} onClick={() => onDialog("table")} />
              <RibbonButton icon={Minus} label="Horizontal line" showLabel large disabled={disabled} onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())} />
              <RibbonButton icon={WrapText} label="Page break" showLabel large disabled={disabled} onClick={() => run(() => editor.chain().focus().setPageBreak().run())} />
              <RibbonButton icon={Square} label="Page setup" showLabel large onClick={() => onDialog("page")} />
            </RibbonGroup>
            <RibbonGroup label="Illustrations">
              <RibbonButton icon={ImageIcon} label="Image" showLabel large disabled={disabled} onClick={() => onDialog("image")} />
              <RibbonButton icon={ImageIcon} label="Logo" showLabel large disabled={disabled} onClick={() => onDialog("logo")} />
            </RibbonGroup>
            <RibbonGroup label="Report fields">
              <DropButton icon={Type} label="Patient fields" large disabled={disabled} width={240}>
                {(close) => FIELD_DEFS.filter((item) => !item.key.startsWith("radiologist") && item.key !== "signature").map((item) => (
                  <MenuItem key={item.key} label={item.label} onClick={() => { editor.chain().focus().insertDataField(item.key).run(); close(); }} />
                ))}
              </DropButton>
              <RibbonButton icon={FileSignature} label="Radiologist" showLabel large disabled={disabled} onClick={() => onDialog("radiologist")} />
              <RibbonButton icon={FileSignature} label="Signature" showLabel large disabled={disabled} onClick={() => onDialog("signature")} />
              <RibbonButton icon={Type} label="Date and time" showLabel large disabled={disabled} onClick={() => onDialog("datetime")} />
              <RibbonButton icon={Pilcrow} label="Page number" showLabel large onClick={() => onDialog("pageNumber")} />
              <RibbonButton icon={Square} label="Header and footer" showLabel large onClick={() => onDialog("header")} />
            </RibbonGroup>
          </>
        )}
        <RibbonGroup label="Dictation">
          <Stack>
            <Row>
              <RibbonButton icon={Mic} label={dictation.listening ? (dictation.paused ? "Resume" : "Stop") : "Dictate"} showLabel className={dictation.listening && !dictation.paused ? "!text-rose-700" : ""} onClick={dictation.toggle} />
              <RibbonButton label="Pause" showLabel disabled={!dictation.listening} onClick={dictation.pause} />
            </Row>
            <Row>
              <select className="we-input h-[26px] max-w-[150px]" aria-label="Dictation language" value={dictation.lang} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => dictation.setLang(event.target.value)}>
                {DICTATION_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Row>
          </Stack>
        </RibbonGroup>
        <RibbonGroup label="Report">
          <RibbonButton icon={Save} label="Save" showLabel large onClick={() => onDialog("save")} />
          <RibbonButton icon={Upload} label="Import" showLabel large disabled={disabled} onClick={() => onDialog("import")} />
          <RibbonButton icon={Square} label="Templates" showLabel large onClick={() => onDialog("templates")} />
          <RibbonButton icon={FileSignature} label="Sign" showLabel large disabled={readOnly} onClick={() => onDialog("finalize")} />
        </RibbonGroup>
      </div>
    </div>
  );
}

export function FormatStrip({ editor, readOnly }) {
  const disabled = readOnly || !editor;
  const family = editor?.getAttributes("textStyle").fontFamily || "Calibri";
  const size = editor ? String(currentFontSize(editor)) : "11";
  const run = (command) => {
    if (disabled) return;
    command();
  };
  return (
    <div className="we-format-strip" onMouseDown={keep} role="toolbar" aria-label="Format">
      <select className="we-format-select w-[128px]" aria-label="Font" disabled={disabled} value={FONTS.includes(family) ? family : "Calibri"} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => run(() => editor.chain().focus().setFontFamily(event.target.value).run())}>
        {FONTS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <select className="we-format-select w-[58px]" aria-label="Size" disabled={disabled} value={SIZES.includes(Number(size)) ? String(Number(size)) : "11"} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => run(() => editor.chain().focus().setFontSize(`${event.target.value}pt`).run())}>
        {SIZES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <span className="we-format-rule" />
      <RibbonButton icon={Bold} label="Bold" disabled={disabled} active={editor?.isActive("bold")} onClick={() => run(() => editor.chain().focus().toggleBold().run())} />
      <RibbonButton icon={Italic} label="Italic" disabled={disabled} active={editor?.isActive("italic")} onClick={() => run(() => editor.chain().focus().toggleItalic().run())} />
      <RibbonButton icon={Underline} label="Underline" disabled={disabled} active={editor?.isActive("underline")} onClick={() => run(() => editor.chain().focus().toggleUnderline().run())} />
      <RibbonButton icon={AlignLeft} label="Align left" disabled={disabled} active={editor?.isActive({ textAlign: "left" })} onClick={() => run(() => editor.chain().focus().setTextAlign("left").run())} />
      <RibbonButton icon={AlignCenter} label="Align centre" disabled={disabled} active={editor?.isActive({ textAlign: "center" })} onClick={() => run(() => editor.chain().focus().setTextAlign("center").run())} />
      <RibbonButton icon={AlignRight} label="Align right" disabled={disabled} active={editor?.isActive({ textAlign: "right" })} onClick={() => run(() => editor.chain().focus().setTextAlign("right").run())} />
      <span className="we-format-rule" />
      <RibbonButton icon={List} label="Bullets" disabled={disabled} active={editor?.isActive("bulletList")} onClick={() => run(() => editor.chain().focus().toggleBulletList().run())} />
      <RibbonButton icon={ListOrdered} label="Numbering" disabled={disabled} active={editor?.isActive("orderedList")} onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())} />
      <RibbonButton icon={Undo2} label="Undo" disabled={disabled || !editor?.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
      <RibbonButton icon={Redo2} label="Redo" disabled={disabled || !editor?.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
    </div>
  );
}
