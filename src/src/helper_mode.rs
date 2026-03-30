const HELPER_MODE_FLAG: &str = "--helper-mode";
const WINDOWS_INSERT_HELPER_ACTION: &str = "windows-insert";
#[cfg(target_os = "windows")]
const HELPER_REQUEST_PATH_FLAG: &str = "--helper-request-path";
#[cfg(target_os = "windows")]
const HELPER_RESPONSE_PATH_FLAG: &str = "--helper-response-path";
const HELPER_ACTION_UNKNOWN_EXIT_CODE: i32 = 1;
const HELPER_MODE_SUCCESS_EXIT_CODE: i32 = 0;

pub fn maybe_run_from_args<Args>(args: Args) -> Option<i32>
where
    Args: IntoIterator<Item = String>,
{
    let args: Vec<String> = args.into_iter().collect();
    let helper_flag_index = args.iter().position(|arg| arg == HELPER_MODE_FLAG)?;
    let helper_action = args.get(helper_flag_index + 1).map(String::as_str);

    if helper_action.is_none() {
        return Some(HELPER_MODE_SUCCESS_EXIT_CODE);
    }

    match helper_action {
        Some(WINDOWS_INSERT_HELPER_ACTION) => {
            #[cfg(target_os = "windows")]
            {
                let request_path = value_after_flag(&args, HELPER_REQUEST_PATH_FLAG);
                let response_path = value_after_flag(&args, HELPER_RESPONSE_PATH_FLAG);
                return Some(crate::text_inserter::run_windows_insertion_helper_mode(
                    request_path,
                    response_path,
                ));
            }

            #[cfg(not(target_os = "windows"))]
            {
                return Some(HELPER_ACTION_UNKNOWN_EXIT_CODE);
            }
        }
        Some(_) => {
            return Some(HELPER_ACTION_UNKNOWN_EXIT_CODE);
        }
        None => {}
    }

    Some(HELPER_MODE_SUCCESS_EXIT_CODE)
}

#[cfg(target_os = "windows")]
fn value_after_flag<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let flag_index = args.iter().position(|arg| arg == flag)?;
    args.get(flag_index + 1).map(String::as_str)
}
