//! The server sidecar: `apokorg-server.exe`, a Node single executable built from
//! `packages/server` by scripts/build-sidecar.ts and shipped as a Tauri `externalBin`.

use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

/// How long to wait for `READY <port>`. The first start migrates the database.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Sidecar {
    pub port: u16,
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    _job: job::Job,
}

impl Sidecar {
    /// Spawns the server on a random port with its data in `data_dir`, and waits for it to
    /// report the port. Its stderr (the server log) goes to `<data_dir>/server.log`.
    pub fn start(data_dir: &Path, mock: bool) -> io::Result<Sidecar> {
        let exe = std::env::current_exe()?
            .with_file_name(format!("apokorg-server{}", std::env::consts::EXE_SUFFIX));
        fs::create_dir_all(data_dir)?;
        let log_path = data_dir.join("server.log");
        let log = File::create(&log_path)?;

        let mut cmd = Command::new(&exe);
        cmd.env("APOKORG_PORT", "0")
            .env("APOKORG_DATA_DIR", data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(log);
        if mock {
            cmd.env("APOKORG_MOCK", "1");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", exe.display())))?;
        #[cfg(windows)]
        let job = match job::Job::kill_on_close(&child) {
            Ok(job) => job,
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(err);
            }
        };

        let stdout = child.stdout.take().expect("stdout is piped");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut tx = Some(tx);
            // Keep draining after READY so the server never blocks on a full pipe.
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(port) = parse_ready(&line) {
                    if let Some(tx) = tx.take() {
                        let _ = tx.send(port);
                    }
                }
            }
        });

        match rx.recv_timeout(READY_TIMEOUT) {
            Ok(port) => Ok(Sidecar {
                port,
                child: Mutex::new(Some(child)),
                #[cfg(windows)]
                _job: job,
            }),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("No READY line from the server. See {}", log_path.display()),
                ))
            }
        }
    }

    /// Kills the server and reaps it. Safe to call more than once.
    pub fn stop(&self) {
        let child = self.child.lock().map(|mut c| c.take()).unwrap_or(None);
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Parses the server's `READY <port>` line.
fn parse_ready(line: &str) -> Option<u16> {
    line.trim().strip_prefix("READY ")?.trim().parse().ok()
}

/// Shows a blocking error box; when the sidecar fails there is no window yet.
pub fn show_error(message: &str) {
    eprintln!("{message}");
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let (text, caption) = (wide(message), wide("apokorg"));
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                caption.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
}

#[cfg(windows)]
mod job {
    //! A job object with KILL_ON_JOB_CLOSE. Windows closes our handle when the app process
    //! ends for any reason, which terminates every process in the job.
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // The handle is only kept to hold the job open, and closed on drop.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn kill_on_close(child: &Child) -> io::Result<Job> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let job = Job(handle);
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 || AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) == 0
                {
                    return Err(io::Error::last_os_error());
                }
                Ok(job)
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_ready;

    #[test]
    fn parses_the_ready_line() {
        assert_eq!(parse_ready("READY 50123"), Some(50123));
        assert_eq!(parse_ready("READY 4517\r"), Some(4517));
        assert_eq!(parse_ready("READY"), None);
        assert_eq!(parse_ready("READY abc"), None);
        assert_eq!(parse_ready(r#"{"level":30}"#), None);
    }
}
