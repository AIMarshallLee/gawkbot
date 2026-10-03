//go:build windows

package workspaces

import (
	"os"

	"golang.org/x/sys/windows"
)

// lockFileExclusive blocks until an exclusive lock is held on f. Caller must
// release via unlockFile.
func lockFileExclusive(f *os.File) error {
	return lockFile(f, windows.LOCKFILE_EXCLUSIVE_LOCK)
}

// lockFileExclusiveNonBlocking attempts to acquire an exclusive lock without
// waiting. LockFileEx reports an error when another handle already holds it.
func lockFileExclusiveNonBlocking(f *os.File) error {
	return lockFile(f, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY)
}

func lockFile(f *os.File, flags uint32) error {
	return windows.LockFileEx(windows.Handle(f.Fd()), flags, 0, 1, 0, &windows.Overlapped{})
}

// unlockFile releases the lock acquired by lockFileExclusive[NonBlocking].
func unlockFile(f *os.File) error {
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, &windows.Overlapped{})
}
