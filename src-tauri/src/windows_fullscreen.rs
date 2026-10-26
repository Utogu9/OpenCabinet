//! Keep the full client area when entering fullscreen from a maximized window.
//!
//! tao 0.37's WM_NCCALCSIZE handler clips maximized undecorated windows to rcWork
//! even in fullscreen. Handle that case before tao, preserving the monitor bounds
//! supplied by its SetWindowPos call. Normal maximization still reserves the taskbar.
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetWindowLongW, GWL_STYLE, WM_NCCALCSIZE, WM_NCDESTROY, WS_MAXIMIZE,
            WS_OVERLAPPEDWINDOW,
        },
    },
};

const SUBCLASS_ID: usize = 0x42424653; // BBFS

pub fn install(hwnd: HWND) -> std::io::Result<()> {
    // SAFETY: setup supplies the live main HWND on its owning UI thread. This
    // subclass owns no pointers and unregisters itself when the window is destroyed.
    if unsafe { SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, 0) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _: usize,
) -> LRESULT {
    if message == WM_NCCALCSIZE && wparam != 0 {
        // tao retains WS_OVERLAPPEDWINDOW for normal undecorated windows and
        // removes it in fullscreen. WS_MAXIMIZE can remain set in both modes.
        // Read native styles here instead of reentering tao's window-state lock.
        let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
        if style & WS_MAXIMIZE != 0 && style & WS_OVERLAPPEDWINDOW == 0 {
            return 0; // The entire proposed window rectangle is client area.
        }
    }
    if message == WM_NCDESTROY {
        unsafe { RemoveWindowSubclass(hwnd, Some(window_proc), id) };
    }
    // SAFETY: forward unchanged to the remaining subclass chain (including tao).
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::RECT,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, IsWindowVisible, RegisterClassW,
            SendMessageW, SetWindowLongW, UnregisterClassW, NCCALCSIZE_PARAMS, WNDCLASSW, WS_POPUP,
        },
    };

    // Reproduce tao's taskbar reservation using real Win32 messages, without
    // opening a visible window or relying on a simulated JavaScript window API.
    unsafe extern "system" fn clipped_window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_NCCALCSIZE {
            if wparam != 0 {
                unsafe { (*(lparam as *mut NCCALCSIZE_PARAMS)).rgrc[0].bottom -= 48 };
                return 0;
            }
            return 73;
        }
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }

    #[test]
    fn maximized_fullscreen_keeps_monitor_bounds_and_normal_maximization_keeps_taskbar() {
        let name: Vec<u16> = "OpenCabinetFullscreenRegression\0".encode_utf16().collect();
        let class = WNDCLASSW {
            lpfnWndProc: Some(clipped_window_proc),
            lpszClassName: name.as_ptr(),
            ..Default::default()
        };
        unsafe {
            assert_ne!(RegisterClassW(&class), 0);
            let hwnd = CreateWindowExW(
                0,
                name.as_ptr(),
                null(),
                WS_POPUP,
                0,
                0,
                800,
                600,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            );
            assert!(!hwnd.is_null());
            assert_eq!(IsWindowVisible(hwnd), 0);
            install(hwnd).unwrap();

            // Include a secondary monitor left of the primary and a tall display.
            for (left, top, right, bottom) in [(0, 0, 1920, 1080), (-2560, 120, 0, 1560)] {
                for (style, clipped) in [
                    (WS_OVERLAPPEDWINDOW | WS_MAXIMIZE, true),
                    (WS_POPUP | WS_MAXIMIZE, false),
                    (WS_OVERLAPPEDWINDOW | WS_MAXIMIZE, true),
                ] {
                    SetWindowLongW(hwnd, GWL_STYLE, style as i32);
                    let rect = RECT {
                        left,
                        top,
                        right,
                        bottom,
                    };
                    let mut params = NCCALCSIZE_PARAMS {
                        rgrc: [rect; 3],
                        lppos: null_mut(),
                    };
                    SendMessageW(hwnd, WM_NCCALCSIZE, 1, &mut params as *mut _ as LPARAM);
                    let client = params.rgrc[0];
                    assert_eq!((client.left, client.top, client.right), (left, top, right));
                    assert_eq!(client.bottom, bottom - if clipped { 48 } else { 0 });
                    assert_eq!(
                        IsWindowVisible(hwnd),
                        0,
                        "the fix never shows/restores the window"
                    );
                }
            }
            SetWindowLongW(hwnd, GWL_STYLE, (WS_POPUP | WS_MAXIMIZE) as i32);
            let mut rect = RECT::default();
            assert_eq!(
                SendMessageW(hwnd, WM_NCCALCSIZE, 0, &mut rect as *mut _ as LPARAM),
                73
            );
            assert_ne!(DestroyWindow(hwnd), 0);
            assert_ne!(UnregisterClassW(name.as_ptr(), null_mut()), 0);
        }
    }
}
