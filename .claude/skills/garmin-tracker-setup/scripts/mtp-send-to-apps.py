#!/usr/bin/env python3
"""
Send a Connect IQ .prg file to GARMIN/Apps on a connected Garmin watch via MTP.

mtp-sendfile (libmtp CLI) always sends to the device root — it has no folder
argument. This script uses libmtp via ctypes to specify parent_id directly,
targeting the GARMIN/Apps folder found by parsing `mtp-folders` output.

Also deletes any existing file with the same name before sending, so
re-deploying doesn't accumulate duplicates.

Usage: mtp-send-to-apps.py <local_file> <remote_name>
"""

import ctypes, ctypes.util, os, re, subprocess, sys


# ── Folder detection ──────────────────────────────────────────────────────────

def find_apps_folder_id() -> int | None:
    """
    Parse `mtp-folders` output to locate the GARMIN/Apps folder.

    mtp-folders outputs:  "<folder_id>\\t<indent><name>"
    where indent depth = number_of_spaces / 2.
    Depth 0 = top-level folder, depth 1 = direct child.

    The correct Apps folder is the first depth-1 "APPS" (case-insensitive)
    child of any depth-0 "GARMIN" folder — this is in Primary storage and is
    where Garmin places sideloaded CIQ .prg files.
    """
    result = subprocess.run(['mtp-folders'], capture_output=True, text=True)
    in_garmin = False

    for line in result.stdout.split('\n'):
        m = re.match(r'^(\d+)\t( *)(.+?)\s*$', line)
        if not m:
            continue
        folder_id = int(m.group(1))
        depth     = len(m.group(2)) // 2
        name      = m.group(3).strip()

        if depth == 0:
            in_garmin = (name.upper() == 'GARMIN')
        elif depth == 1 and in_garmin and name.upper() == 'APPS':
            return folder_id   # First APPS under GARMIN = Primary storage

    return None


# ── Existing file lookup (for overwrite) ────────────────────────────────────

def find_existing_file_id(remote_name: str, apps_folder_id: int) -> int | None:
    """Return the MTP file ID of an existing file with this name in Apps, or None."""
    result = subprocess.run(['mtp-files'], capture_output=True, text=True)
    current_id   = None
    current_name = None
    current_parent = None

    for line in result.stdout.split('\n'):
        m_id     = re.search(r'File ID:\s*(\d+)', line)
        m_name   = re.search(r'Filename:\s*(.+)', line)
        m_parent = re.search(r'Parent ID:\s*(\d+)', line)

        if m_id:
            current_id, current_name, current_parent = int(m_id.group(1)), None, None
        if m_name and current_id is not None:
            current_name = m_name.group(1).strip()
        if m_parent and current_id is not None:
            current_parent = int(m_parent.group(1))

        # Once we have all three, check for a match
        if current_id and current_name and current_parent is not None:
            if (current_name.lower() == remote_name.lower()
                    and current_parent == apps_folder_id):
                return current_id
            current_id = current_name = current_parent = None

    return None


def delete_file(file_id: int) -> None:
    subprocess.run(['mtp-delfile', str(file_id)],
                   capture_output=True, check=False)


# ── libmtp via ctypes ────────────────────────────────────────────────────────

class LIBMTP_file_t(ctypes.Structure):
    # Layout matches libmtp.h LIBMTP_file_struct on 64-bit (ARM/x86).
    # ctypes adds alignment padding automatically between fields.
    _fields_ = [
        ("item_id",          ctypes.c_uint32),
        ("parent_id",        ctypes.c_uint32),
        ("storage_id",       ctypes.c_uint32),
        ("filename",         ctypes.c_char_p),   # 8-byte aligned; ctypes pads after storage_id
        ("filesize",         ctypes.c_uint64),
        ("modificationdate", ctypes.c_int64),    # time_t = int64 on 64-bit
        ("filetype",         ctypes.c_int),
        ("next",             ctypes.c_void_p),   # 8-byte aligned; ctypes pads after filetype
    ]


def _load_libmtp() -> ctypes.CDLL:
    lib_path = ctypes.util.find_library('mtp') or '/opt/homebrew/lib/libmtp.dylib'
    try:
        lib = ctypes.CDLL(lib_path)
    except OSError as exc:
        raise SystemExit(f"Cannot load libmtp ({lib_path}): {exc}") from exc

    lib.LIBMTP_Init.restype  = None
    lib.LIBMTP_Init.argtypes = []

    lib.LIBMTP_Get_First_Device.restype  = ctypes.c_void_p
    lib.LIBMTP_Get_First_Device.argtypes = []

    lib.LIBMTP_new_file_t.restype  = ctypes.POINTER(LIBMTP_file_t)
    lib.LIBMTP_new_file_t.argtypes = []

    lib.LIBMTP_Send_File_From_File.restype  = ctypes.c_int
    lib.LIBMTP_Send_File_From_File.argtypes = [
        ctypes.c_void_p,
        ctypes.c_char_p,
        ctypes.POINTER(LIBMTP_file_t),
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]

    lib.LIBMTP_destroy_file_t.restype  = None
    lib.LIBMTP_destroy_file_t.argtypes = [ctypes.POINTER(LIBMTP_file_t)]

    lib.LIBMTP_Release_Device.restype  = None
    lib.LIBMTP_Release_Device.argtypes = [ctypes.c_void_p]

    return lib


def send_file(local_path: str, remote_name: str, apps_folder_id: int) -> int:
    lib = _load_libmtp()
    lib.LIBMTP_Init()

    device = lib.LIBMTP_Get_First_Device()
    if not device:
        print("ERROR: no MTP device found", file=sys.stderr)
        return 1

    filedata = lib.LIBMTP_new_file_t()
    if not filedata:
        lib.LIBMTP_Release_Device(device)
        print("ERROR: could not allocate LIBMTP_file_t", file=sys.stderr)
        return 1

    filedata.contents.parent_id  = apps_folder_id
    filedata.contents.storage_id = 0   # let libmtp pick
    filedata.contents.filename   = remote_name.encode('utf-8')
    filedata.contents.filesize   = os.path.getsize(local_path)
    filedata.contents.filetype   = 0   # LIBMTP_FILETYPE_UNKNOWN

    ret = lib.LIBMTP_Send_File_From_File(
        device,
        local_path.encode('utf-8'),
        filedata,
        None, None,
    )

    lib.LIBMTP_destroy_file_t(filedata)
    lib.LIBMTP_Release_Device(device)
    return 0 if ret == 0 else 1


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <local_file> <remote_name>", file=sys.stderr)
        sys.exit(1)

    local_path  = sys.argv[1]
    remote_name = sys.argv[2]

    if not os.path.isfile(local_path):
        print(f"ERROR: {local_path} not found", file=sys.stderr)
        sys.exit(1)

    print("Scanning device folders...")
    apps_id = find_apps_folder_id()
    if apps_id is None:
        print("ERROR: GARMIN/Apps folder not found — is the watch connected in MTP mode?",
              file=sys.stderr)
        sys.exit(1)
    print(f"  GARMIN/Apps folder ID: {apps_id}")

    # Delete existing file with same name to avoid duplicates
    existing = find_existing_file_id(remote_name, apps_id)
    if existing is not None:
        print(f"  Deleting existing {remote_name} (ID {existing})...")
        delete_file(existing)

    print(f"  Sending {local_path} → {remote_name} ...")
    rc = send_file(local_path, remote_name, apps_id)

    if rc == 0:
        print(f"✓  Sent {remote_name} to GARMIN/Apps")
    else:
        print("ERROR: send failed — check that the watch is still connected", file=sys.stderr)

    sys.exit(rc)


if __name__ == '__main__':
    main()
