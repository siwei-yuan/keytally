# usage_lights.c/h 由 build.sh 从 firmware/common/ 拷入本 keymap 目录
VIA_ENABLE = yes
RAW_ENABLE = yes

# 原厂 rules 关掉了 bootmagic;我们打开(config.h 已定 (0,0)=Esc),
# 保证「按住 Esc 插线」在 Pro 固件下也永远能进 DFU
BOOTMAGIC_ENABLE = yes

SRC += usage_lights.c
