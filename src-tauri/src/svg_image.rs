//! Validate static SVG images before exposing them as local artwork.
use quick_xml::{events::Event, Reader};
use std::{fs, path::Path};

pub(crate) fn valid(path: &Path) -> bool {
    if !fs::metadata(path).is_ok_and(|m| m.len() <= 4 * 1024 * 1024) {
        return false;
    }
    fs::read(path).is_ok_and(|bytes| valid_bytes(&bytes))
}
fn safe_css(value: &str) -> bool {
    let css = value
        .to_ascii_lowercase()
        .replace([' ', '\n', '\r', '\t', '\'', '"'], "");
    !css.contains('@')
        && !css.contains('\\')
        && css.split("url(").skip(1).all(|v| v.starts_with('#'))
}
fn embedded_raster(value: &str) -> bool {
    let Some((header, data)) = value.trim().split_once(',') else {
        return false;
    };
    if !matches!(
        header,
        "data:image/png;base64"
            | "data:image/jpeg;base64"
            | "data:image/webp;base64"
            | "data:image/gif;base64"
    ) {
        return false;
    }
    let mut count = 0;
    let mut padding = 0;
    for byte in data.bytes().filter(|b| !b.is_ascii_whitespace()) {
        count += 1;
        if byte == b'=' {
            padding += 1;
        } else if padding != 0 || !(byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/')) {
            return false;
        }
    }
    count > 0 && count % 4 == 0 && padding <= 2
}
fn standard_doctype(bytes: &[u8]) -> bool {
    // Recognize common Illustrator/Inkscape export headers only. The XML reader
    // does not load these DTDs; custom subsets and entity declarations stay blocked.
    fn quoted(value: &str) -> Option<(&str, &str)> {
        if !value.starts_with(char::is_whitespace) {
            return None;
        }
        let value = value.trim_start();
        let quote = value.chars().next().filter(|c| matches!(c, '\'' | '"'))?;
        value[1..].split_once(quote)
    }
    let Ok(value) = std::str::from_utf8(bytes) else {
        return false;
    };
    let Some(rest) = value.trim().strip_prefix("svg") else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    if !rest.starts_with(char::is_whitespace) {
        return false;
    }
    let Some(rest) = rest.trim_start().strip_prefix("PUBLIC") else {
        return false;
    };
    let Some((public, rest)) = quoted(rest) else {
        return false;
    };
    let Some((uri, rest)) = quoted(rest) else {
        return false;
    };
    rest.trim().is_empty()
        && matches!(
            (public, uri),
            (
                "-//W3C//DTD SVG 1.0//EN",
                "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd"
                    | "https://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd"
            ) | (
                "-//W3C//DTD SVG 1.1//EN",
                "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"
                    | "https://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"
            )
        )
}
fn valid_bytes(bytes: &[u8]) -> bool {
    let mut reader = Reader::from_reader(bytes);
    let mut depth = 0usize;
    let mut root = false;
    let mut style = false;
    let mut doctype = false;
    loop {
        match reader.read_event() {
            Ok(event @ (Event::Start(_) | Event::Empty(_))) => {
                let empty = matches!(&event, Event::Empty(_));
                let e = match event {
                    Event::Start(e) | Event::Empty(e) => e,
                    _ => unreachable!(),
                };
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if depth == 0 {
                    if root || name != "svg" {
                        return false;
                    }
                    root = true;
                }
                if [
                    "script",
                    "foreignobject",
                    "iframe",
                    "object",
                    "embed",
                    "a",
                    "animate",
                    "animatetransform",
                    "animatemotion",
                    "set",
                ]
                .contains(&name.as_str())
                {
                    return false;
                }
                style = name == "style";
                for attr in e.attributes() {
                    let Ok(attr) = attr else { return false };
                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_ascii_lowercase();
                    let Ok(value) = attr.unescape_value() else {
                        return false;
                    };
                    if key.rsplit(':').next().is_some_and(|key|key.starts_with("on"))
                        || key == "src"
                        || (key.ends_with("href") && !value.trim().starts_with('#')
                            && !(name == "image" && embedded_raster(&value)))
                        // Namespaced editor metadata (e.g. sodipodi:docbase)
                        // is not CSS; Windows paths there are harmless.
                        || (!key.contains(':') && !safe_css(&value))
                    {
                        return false;
                    }
                }
                if !empty {
                    depth += 1;
                }
            }
            Ok(Event::End(_)) => {
                let Some(next) = depth.checked_sub(1) else {
                    return false;
                };
                depth = next;
                style = false;
            }
            Ok(Event::Text(t)) if style => {
                if !t.xml_content().is_ok_and(|v| safe_css(&v)) {
                    return false;
                }
            }
            Ok(Event::CData(t)) if style => {
                if !std::str::from_utf8(&t).is_ok_and(safe_css) {
                    return false;
                }
            }
            Ok(Event::DocType(value)) => {
                if root || depth != 0 || doctype || !standard_doctype(&value) {
                    return false;
                }
                doctype = true;
            }
            Ok(Event::PI(_)) | Ok(Event::GeneralRef(_)) | Err(_) => return false,
            Ok(Event::Eof) => return root && depth == 0,
            _ => (),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_embedded_raster_exports_and_inert_editor_metadata() {
        // Illustrator exports may include a hidden bitmap reference (PS4).
        assert!(valid_bytes(br#"<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image display="none" xlink:href="data:image/png;base64,iVBORw0KGgo=
"/></svg>"#));
        // Inkscape keeps the original editor directory as inert metadata (PSP).
        assert!(valid_bytes(br#"<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" sodipodi:docbase="F:\Logos"><path d="M0 0"/></svg>"#));
        for bytes in [
            b"<svg><image href='https://example.com/logo.png'/></svg>".as_slice(),
            b"<svg><image href='file:///logo.png'/></svg>".as_slice(),
            b"<svg><image href='data:image/svg+xml;base64,PHN2Zy8+' /></svg>".as_slice(),
            b"<svg><image href='data:text/html;base64,PHN2Zy8+' /></svg>".as_slice(),
            b"<svg><image href='data:image/png;base64,invalid!'/></svg>".as_slice(),
            b"<svg><image href='data:image/png;base64,AA==AA=='/></svg>".as_slice(),
            b"<svg xmlns:custom='urn:custom'><image custom:onload='x'/></svg>".as_slice(),
            b"<svg style='fill:url(file:///logo.png)'/>".as_slice(),
        ] {
            assert!(!valid_bytes(bytes));
        }
    }
    #[test]
    fn accepts_standard_svg_export_doctypes_without_accepting_custom_entities() {
        // The public PS3 logo is an Illustrator SVG 1.0 export with this prolog.
        let svg=br#"<?xml version="1.0" encoding="utf-8"?>
            <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">
            <svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>"#;
        assert!(valid_bytes(svg));
        assert!(valid_bytes(b"<!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'><svg/>"));
        for bytes in [
            b"<!DOCTYPE svg SYSTEM 'https://example.com/custom.dtd'><svg/>".as_slice(),
            b"<!DOCTYPE svg [<!ENTITY content SYSTEM 'file:///private.txt'>]><svg>&content;</svg>".as_slice(),
            b"<!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.0//EN' 'http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd' [<!ENTITY x 'custom'>]><svg/>".as_slice(),
            b"<!DOCTYPE svg><!DOCTYPE svg><svg/>".as_slice(),
            b"<svg><!DOCTYPE svg></svg>".as_slice(),
            b"<!DOCTYPE svg><svg><script/></svg>".as_slice(),
        ]{assert!(!valid_bytes(bytes));}
    }
    #[test]
    fn accepts_static_logos_and_rejects_active_external_or_invalid_content() {
        let sample =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/repository-static-logo.svg");
        assert_eq!(crate::image_extension(&sample).unwrap(), "svg");
        assert!(valid_bytes(br##"<svg xmlns="http://www.w3.org/2000/svg"><defs><style>.a{fill:url(#a)}</style></defs><path d="M0 0"/></svg>"##));
        for bytes in [
            b"<svg><script/></svg>".as_slice(),
            b"<svg xmlns:s='http://www.w3.org/2000/svg'><s:script/></svg>".as_slice(),
            b"<svg onload='x'/>".as_slice(),
            b"<svg><use href='https://example.com/a'/></svg>".as_slice(),
            b"<svg><style>@import 'x'</style></svg>".as_slice(),
            b"<svg>".as_slice(),
            b"<html/>".as_slice(),
        ] {
            assert!(!valid_bytes(bytes));
        }
    }
}
