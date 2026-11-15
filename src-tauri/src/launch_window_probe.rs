//! Inspect only the process we launched and its descendants. Existing Steam/Epic
//! clients and native Wayland surfaces use the presentation's bounded timer.
#[cfg(any(windows,target_os="linux"))]
use std::collections::HashSet;

#[cfg(windows)]
pub struct Probe { processes:HashSet<u32> }
#[cfg(windows)]
impl Probe {
    pub fn new()->Self {Self{processes:HashSet::new()}}
    pub fn window(&mut self,pid:u32)->Option<u64> {
        use windows_sys::Win32::{Foundation::{CloseHandle,INVALID_HANDLE_VALUE},System::Diagnostics::ToolHelp::*};
        self.processes.insert(pid);
        // Remember descendants before launchers reparent or exit.
        let mut snapshot=vec![];
        unsafe {
            let handle=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
            if handle!=INVALID_HANDLE_VALUE {
                let mut entry:PROCESSENTRY32W=std::mem::zeroed();entry.dwSize=std::mem::size_of::<PROCESSENTRY32W>() as u32;
                let mut valid=Process32FirstW(handle,&mut entry)!=0;
                while valid {snapshot.push((entry.th32ProcessID,entry.th32ParentProcessID));valid=Process32NextW(handle,&mut entry)!=0;}
                CloseHandle(handle);
            }
        }
        descendants(&mut self.processes,&snapshot);
        struct Search<'a>{processes:&'a HashSet<u32>,window:Option<u64>}
        unsafe extern "system" fn inspect(hwnd:windows_sys::Win32::Foundation::HWND,parameter:isize)->i32 {
            use windows_sys::Win32::{Foundation::RECT,UI::WindowsAndMessaging::*};
            let search=unsafe{&mut *(parameter as *mut Search<'_>)};let mut pid=0;
            unsafe {GetWindowThreadProcessId(hwnd,&mut pid);}
            if !search.processes.contains(&pid){return 1;}
            unsafe {
                if IsWindowVisible(hwnd)==0||IsIconic(hwnd)!=0||IsHungAppWindow(hwnd)!=0
                    ||!GetWindow(hwnd,GW_OWNER).is_null()||GetWindowLongW(hwnd,GWL_EXSTYLE) as u32&WS_EX_TOOLWINDOW!=0{return 1;}
                let mut rect:RECT=std::mem::zeroed();
                if GetClientRect(hwnd,&mut rect)==0||rect.right-rect.left<320||rect.bottom-rect.top<180{return 1;}
                let mut result=0;
                if SendMessageTimeoutW(hwnd,WM_NULL,0,0,SMTO_ABORTIFHUNG|SMTO_BLOCK,50,&mut result)==0{return 1;}
                // Include dimensions: resizing/replacing a startup window resets stability.
                search.window=Some((hwnd as usize as u64).wrapping_mul(1_000_003)
                    ^(((rect.right-rect.left)as u64)<<32)^(rect.bottom-rect.top)as u64);
            }
            0
        }
        let mut search=Search{processes:&self.processes,window:None};
        unsafe {windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows(Some(inspect),&mut search as *mut _ as isize);}
        search.window
    }
}
#[cfg(target_os="linux")]
pub struct Probe { processes:HashSet<u32> }
#[cfg(target_os="linux")]
impl Probe {
    pub fn new()->Self {Self{processes:HashSet::new()}}
    pub fn window(&mut self,pid:u32)->Option<u64> {
        // Wayland has no cross-application window inspection API. On X11 use
        // xprop in an isolated, bounded process: a disappearing X window must
        // never invoke Xlib's fatal error handler inside the application.
        if std::env::var("XDG_SESSION_TYPE").is_ok_and(|value|value=="wayland"){return None;}
        if std::env::var_os("DISPLAY").is_none(){return None;}
        let root=xprop(&["-root","_NET_ACTIVE_WINDOW"])?;
        let window=root.split_whitespace().rev().find(|word|word.starts_with("0x"))?;
        let id=u64::from_str_radix(window.trim_start_matches("0x"),16).ok()?;
        if id==0{return None;}
        let details=xprop(&["-id",window,"_NET_WM_PID","_NET_WM_WINDOW_TYPE","_NET_WM_STATE"])?;
        if details.contains("_NET_WM_STATE_HIDDEN")||details.contains("_NET_WM_WINDOW_TYPE_SPLASH")
            ||details.contains("_NET_WM_WINDOW_TYPE_DIALOG")||details.contains("_NET_WM_WINDOW_TYPE_UTILITY"){return None;}
        let owner=details.lines().find(|line|line.starts_with("_NET_WM_PID"))?
            .split('=').nth(1)?.trim().parse::<u32>().ok()?;
        self.processes.insert(pid);
        let snapshot=std::fs::read_dir("/proc").ok()?.flatten().filter_map(|entry|{
            let id=entry.file_name().to_str()?.parse().ok()?;
            let stat=super::linux_process::parse_stat(&std::fs::read_to_string(entry.path().join("stat")).ok()?)?;
            (!stat.zombie).then_some((id,stat.parent))
        }).collect::<Vec<_>>();
        descendants(&mut self.processes,&snapshot);
        self.processes.contains(&owner).then_some(id)
    }
}
#[cfg(target_os="linux")]
fn xprop(args:&[&str])->Option<String> {
    use std::{process::{Command,Stdio},time::{Duration,Instant},io::Read};
    let mut child=Command::new("xprop").args(args).env("LC_ALL","C")
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let deadline=Instant::now()+Duration::from_millis(150);
    loop {
        match child.try_wait() {
            Ok(Some(status))=>{
                if !status.success(){return None;}
                let mut bytes=vec![];child.stdout.take()?.take(8192).read_to_end(&mut bytes).ok()?;
                return String::from_utf8(bytes).ok();
            },
            Ok(None) if Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(5)),
            _=>{let _=child.kill();let _=child.wait();return None;}
        }
    }
}

#[cfg(not(any(windows,target_os="linux")))]
pub struct Probe;
#[cfg(not(any(windows,target_os="linux")))]
impl Probe {pub fn new()->Self{Self} pub fn window(&mut self,_:u32)->Option<u64>{None}}

#[cfg(any(windows,target_os="linux",test))]
fn descendants(known:&mut std::collections::HashSet<u32>,snapshot:&[(u32,u32)]) {
    loop {
        let before=known.len();
        for &(pid,parent) in snapshot {if known.contains(&parent){known.insert(pid);}}
        if known.len()==before{break;}
    }
}
#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn detects_a_real_visible_window_and_rejects_hidden_surfaces() {
        use windows_sys::Win32::UI::WindowsAndMessaging::*;
        let name:Vec<u16>="OpenCabinetLaunchProbeTest\0".encode_utf16().collect();
        unsafe {
            let class=WNDCLASSW{lpfnWndProc:Some(DefWindowProcW),lpszClassName:name.as_ptr(),..std::mem::zeroed()};
            assert_ne!(RegisterClassW(&class),0);
            let window=CreateWindowExW(0,name.as_ptr(),name.as_ptr(),WS_OVERLAPPEDWINDOW,0,0,640,480,
                std::ptr::null_mut(),std::ptr::null_mut(),std::ptr::null_mut(),std::ptr::null());
            assert!(!window.is_null());
            let mut probe=super::Probe::new();let pid=std::process::id();
            assert!(probe.window(pid).is_none());
            ShowWindow(window,SW_SHOWNOACTIVATE);
            let first=probe.window(pid).expect("a responding visible process window");
            SetWindowPos(window,std::ptr::null_mut(),0,0,800,600,SWP_NOZORDER|SWP_NOACTIVATE);
            assert_ne!(probe.window(pid),Some(first),"resizing must reset readiness stability");
            ShowWindow(window,SW_HIDE);assert!(probe.window(pid).is_none());
            DestroyWindow(window);UnregisterClassW(name.as_ptr(),std::ptr::null_mut());
        }
    }
    #[test]
    fn descendants_include_wrappers_but_never_unrelated_processes() {
        let mut known=std::collections::HashSet::from([10]);
        super::descendants(&mut known,&[(30,20),(11,1),(20,10),(40,30)]);
        assert_eq!(known,std::collections::HashSet::from([10,20,30,40]));
        super::descendants(&mut known,&[(50,40),(12,11)]);
        assert!(known.contains(&50));assert!(!known.contains(&12));
    }
}
