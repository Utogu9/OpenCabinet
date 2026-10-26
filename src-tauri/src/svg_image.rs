//! Validate static SVG images before exposing them as local artwork.
use quick_xml::{Reader, events::Event};
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
fn valid_bytes(bytes: &[u8]) -> bool {
    let mut reader = Reader::from_reader(bytes);
    let mut depth = 0usize;
    let mut root = false;
    let mut style = false;
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
                    "image",
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
                        || (key.ends_with("href") && !value.trim().starts_with('#'))
                        || !safe_css(&value)
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
            Ok(Event::DocType(_)) | Ok(Event::PI(_)) | Ok(Event::GeneralRef(_)) | Err(_) => return false,
            Ok(Event::Eof) => return root && depth == 0,
            _ => (),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_static_logos_and_rejects_active_external_or_invalid_content() {
        let sample=Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/repository-static-logo.svg");
        assert_eq!(crate::image_extension(&sample).unwrap(),"svg");
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
