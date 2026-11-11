#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
task_root=$(pwd)
mkdir -p outputs/concat-validation/build-temp
export TEMP="$(cygpath -w "$task_root/outputs/concat-validation/build-temp")"
export TMP="$TEMP"
task_vs='/d/notebook/software/Visual Studio 18/VisualStudio18'
export CC='D:/notebook/software/Visual Studio 18/VisualStudio18/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe'
export CXX="$CC"
export INCLUDE='D:\notebook\software\Visual Studio 18\VisualStudio18\VC\Tools\MSVC\14.44.35207\include;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um'
export FFMPEG_DIR="$(cygpath -w "$task_root/outputs/concat-validation/deps/ffmpeg/ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1")"
export LIBCLANG_PATH="$(cygpath -w "$task_root/outputs/concat-validation/deps/clang/libclang-18.1.1.data/platlib/clang/native")"
export PATH="$task_vs/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64:$task_vs/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin:$task_root/outputs/concat-validation/deps/ffmpeg/ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1/bin:$PATH"
export CARGO_PROFILE_DEV_DEBUG=0
cargo build --manifest-path Concat/src/Cargo.toml -p "${1:-concat-cli}" --locked
