# customize.sh - 安装脚本（KernelSU 在解压 zip 后执行本文件）
#
# 规范要求（KernelSU 文档 "Module guide"）：
#   - 所有脚本用 MODDIR=${0%/*} 取自身目录，不要硬编码 /data/adb/modules/<id>
#   - 只在这里做安装期决策；运行期逻辑放 service.sh
#   - SKIPUNZIP=0 表示照常解压；置 1 则完全自己解压
#
# 本模块不含 system/ 覆盖，也不需要 sepolicy.rule：
# 它只是把若干 .ko 放进 ko/，由 service.sh 在 late_start 阶段按 KMI 加载。

SKIPUNZIP=0

# 文案语言目录。安装期就按系统语言显示，国际用户不用看中文猜。
# shellcheck source=i18n.sh
[ -f "${MODPATH:-.}/i18n.sh" ] && . "${MODPATH:-.}/i18n.sh"
[ -f "${0%/*}/i18n.sh" ] && . "${0%/*}/i18n.sh"

ui_print " "
ui_print "*********************************"
ui_print "  Droidspaces LKM"
ui_print "  ${M_INSTALL_TAGLINE}"
ui_print "*********************************"
ui_print " "

# 只支持 arm64：全部 .ko 都是 aarch64
case "$(uname -m)" in
    aarch64|arm64) ;;
    *)
        ui_print "! ${M_ARCH_UNSUPPORTED}$(uname -m)"
        abort "  ${M_INSTALL_ABORTED}"
        ;;
esac

KREL=$(uname -r)
ui_print "- ${M_KERNEL}: $KREL"

# 提前告诉用户会选中哪个 KMI，装错包时一眼能看出来（见 issues/1）
major=$(echo "$KREL" | grep -oE '^[0-9]+[.][0-9]+')
case "$major" in
    5.10) ui_print "- ${M_KERNEL_LINE}: 5.10 (Android 12 / 13)" ;;
    5.15) ui_print "- ${M_KERNEL_LINE}: 5.15 (Android 13 / 14)" ;;
    6.1)  ui_print "- ${M_KERNEL_LINE}: 6.1 (Android 14)" ;;
    6.6)  ui_print "- ${M_KERNEL_LINE}: 6.6 (Android 15)" ;;
    6.12) ui_print "- ${M_KERNEL_LINE}: 6.12 (Android 16)" ;;
    *)    ui_print "! ${M_KERNEL_UNSUPPORTED}: ${major:-?}" ;;
esac

ui_print "- ${M_COMPONENTS}: lkm4ctr / devtmpfs_lkm / macvlan / ip6table_nat / vkms"
ui_print "-                droid_lkm_pids / droid_lkm_cpu"
ui_print "- ${M_LOAD_STAGE}"

# ---------------------------------------------------------------------------
# 单 KMI 包的代际校验（5.10 / 5.15 各有两代共用同一个内核版本号）
#
# 5.10 上 android12-5.10 与 android13-5.10 的内核串都是 5.10.x，vermagic 只比到
# 5.10 这一层（见 service.sh 的 ko_vermagic_ok），所以拿错包也会"装得上"。
# 装错代的后果不是报错，而是模块在 namespace 路径上卡死（issue #1 的两位
# 报告者都是拿了 android12 包装到出厂 API level=33 的 android13 设备上）。
#
# 判据用**出厂** API level（ro.board.first_api_level），不用会随 OTA 漂的
# ro.build.version.release。全 KMI 包（ko/ 里有多代）不在这里校验，交给
# service.sh 按同样的规则选。
# ---------------------------------------------------------------------------
pkg_android=""
case "$(ls ko/*.ko 2>/dev/null | head -1)" in
    *-android[0-9]*-*) pkg_android=$(ls ko/*.ko 2>/dev/null | head -1 | sed -E 's/.*-(android[0-9]+)-.*/\1/') ;;
esac
pkg_all_same=1
for f in ko/*.ko; do
    [ -f "$f" ] || continue
    a=$(echo "$f" | sed -E 's/.*-(android[0-9]+)-.*/\1/')
    [ "$a" = "$pkg_android" ] || pkg_all_same=0
done

dev_android=""
api=$(getprop ro.board.first_api_level 2>/dev/null | grep -oE '^[0-9]+')
[ -z "$api" ] && api=$(getprop ro.product.first_api_level 2>/dev/null | grep -oE '^[0-9]+')
case "$api" in
    31|32) dev_android=android12 ;;
    33)    dev_android=android13 ;;
    34)    dev_android=android14 ;;
    35)    dev_android=android15 ;;
    36)    dev_android=android16 ;;
    37)    dev_android=android17 ;;
    # 厂商有时把 first_api_level 写成 YYYYMM，按 2009 偏移折算
    [0-9][0-9][0-9][0-9][0-9][0-9])
        dev_android=android$(( ${api:0:4} - 2009 )) ;;
esac

if [ -n "$pkg_android" ] && [ "$pkg_all_same" = 1 ]; then
    if [ -z "$dev_android" ]; then
        ui_print "! ${M_KMI_UNKNOWN}"
    elif [ "$pkg_android" != "$dev_android" ]; then
        ui_print "! ${M_KMI_MISMATCH_HEAD}"
        ui_print "!   $(msg "$M_KMI_MISMATCH" "$pkg_android" "$dev_android")"
        ui_print "! ${M_KMI_MISMATCH_TAIL}"
        abort "  ${M_INSTALL_ABORTED}"
    fi
fi
# 升级 / 重装：上一版留下的黑名单与崩溃记录属于旧构建。
# 状态目录在模块目录之外，不清的话修好的新版本也会被「上次卡死」永久拦住。
# 保护机制不受影响：新版本若再卡死，开机面包屑会重新把它拉黑。
# hang-report / pstore 现场保留，作为排查证据。
_SD=/data/adb/droidspaces_lkm.d
if [ -f "$_SD/blacklist" ] || [ -f "$_SD/crash-module.txt" ] || [ -f "$_SD/loading" ]; then
    ui_print "- Cleared stale boot-failure state (blacklist) from the previous version"
fi
rm -f "$_SD/blacklist" "$_SD/crash-module.txt" "$_SD/loading" /data/adb/droidspaces_lkm.bootcount 2>/dev/null

ui_print " "
ui_print "- ${M_RUNTIME_LOG}: /data/adb/droidspaces_lkm.log"
ui_print "- ${M_HANG_REPORT}: /data/adb/droidspaces_lkm.d/hang-report.txt"
ui_print "- ${M_STATUS_QUERY}"
ui_print " "

# description 保持仓库里的英文，不按系统语言改写。
#
# 改写是安装时一次性的：之后用户换系统语言，模块页仍显示旧语言，看起来像
# 「没识别到英文」。KernelSU 的模块列表是英文界面，描述统一用英文最稳。
# 语言相关的只是安装过程的提示（走 i18n.sh）。

# ---------------------------------------------------------------------------
# 显示路线（route）：auto / anland6 / desktop5
#
# 老安装升级时优先保留原选择；没有旧配置且是 MTK 平台就弹音量键选项。
# 管理器只拦 UI 层按键，这里读 evdev 原始事件；读不到不阻塞安装。
# ---------------------------------------------------------------------------
ROUTE_FILE="${MODPATH:-.}/route"
ROUTE_OLD=/data/adb/modules/droidspaces_lkm/route

route_valid() {
    case "$1" in
        auto|anland6|desktop5) return 0 ;;
        *) return 1 ;;
    esac
}

route_soc_is_mtk() {
    _p="$(getprop ro.board.platform 2>/dev/null)$(getprop ro.soc.model 2>/dev/null)$(getprop ro.hardware 2>/dev/null)"
    _p=$(printf '%s' "$_p" | tr '[:upper:]' '[:lower:]')
    case "$_p" in
        *mtk*|*mediatek*|*mt[0-9]*) return 0 ;;
        *) return 1 ;;
    esac
}

route_keytest() {
    command -v timeout >/dev/null 2>&1 || { echo none; return; }
    _out=$(timeout 8 getevent -ql 2>/dev/null | grep -m1 -E 'KEY_VOLUMEUP|KEY_VOLUMEDOWN|KEY_VOLUME')
    if [ -z "$_out" ]; then
        # 兜底：逐个输入设备各听 1 秒
        for _d in /dev/input/event*; do
            [ -r "$_d" ] || continue
            _out=$(timeout 1 getevent -ql "$_d" 2>/dev/null | grep -m1 -E 'KEY_VOLUMEUP|KEY_VOLUMEDOWN|KEY_VOLUME')
            [ -n "$_out" ] && break
        done
    fi
    case "$_out" in
        *KEY_VOLUMEUP*) echo up ;;
        *KEY_VOLUMEDOWN*) echo down ;;
        *) echo none ;;
    esac
}

ROUTE=""
if [ -f "$ROUTE_OLD" ] && [ "$ROUTE_OLD" != "$ROUTE_FILE" ]; then
    ROUTE=$(cat "$ROUTE_OLD" 2>/dev/null)
fi
if route_valid "$ROUTE"; then
    ui_print "- $(printf "$M_ROUTE_KEEP" "$ROUTE")"
else
    if route_soc_is_mtk; then
        ui_print "! ${M_ROUTE_NEED}"
        ui_print "  ${M_ROUTE_OPT6}"
        ui_print "  ${M_ROUTE_OPT5}"
        ui_print "  ${M_ROUTE_WAIT}"
        case "$(route_keytest)" in
            up)   ROUTE=anland6 ;;
            down) ROUTE=desktop5 ;;
            *)    ROUTE=auto ;;
        esac
        [ "$ROUTE" = auto ] && ui_print "! ${M_ROUTE_NO_KEY}"
    else
        ROUTE=auto
        ui_print "- ${M_ROUTE_QUALCOMM}"
    fi
fi
printf '%s\n' "$ROUTE" > "$ROUTE_FILE" 2>/dev/null
ui_print "- $(printf "$M_ROUTE_SET" "$ROUTE")"
ui_print "- ${M_ROUTE_WEBUI}"
ui_print "- ${M_PACKAGES}"
ui_print "  5.x: https://github.com/misaka5202/Droidspaces-rootfs-Desktop-builder"
ui_print "  6.x: https://github.com/misaka5202/droidspaces-anland6-rootfs"

ui_print "${M_REBOOT_AFTER}"
ui_print " "