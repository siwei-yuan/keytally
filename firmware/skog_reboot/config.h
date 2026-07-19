#pragma once

// 实机观察(机主确认):灯珠是标准 GRB 字节序。原厂配置写死 WS2812_BYTE_ORDER_RGB,
// 导致红绿互换(通用模式里 app 曾用 swap_rg 开关补偿)。这里撤销该定义,
// 让 ws2812 驱动回落到默认 GRB,硬件颜色即为所见即所得。
#undef WS2812_BYTE_ORDER
