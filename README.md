# RoastSee Fusion 网页上位机

配套设备软件 0.1.2，网页 v1.0.0，通信适配实现 1.0.19。原公式与最终测量计算由设备完成。

后续 App 对接请阅读下方“App 开发协议”章节：串口与 BLE 共用业务帧、命令及 JSON 应答，BLE 另有分片头。以下说明以本发布的实际固件为准，不是新协议设计。

## 在线使用

**[打开 RoastSee Fusion 网页上位机](https://sdoahgo.github.io/LEBREW-Three-in-One-Upper-Computer-Web/)**

在电脑上用最新版 Chrome 或 Edge 打开，点「连接串口」或「连接蓝牙」并授权对应设备。可测量、采集、调节设备参数或选择配套应用镜像进行串口 / BLE 升级。「模拟设备」可在没有实物时试用界面。

热点升级请在联网时打开页面，选择镜像后按提示切换到设备 WiFi，保留当前页面并允许浏览器访问本地网络。如果浏览器阻止连接热点，请按下方说明启动本机版。原版 UDP / TCP 局域网搜索由本机版提供。

## 本机运行

本地服务只使用 Node.js 内置模块，建议 Node.js 20 或更新版本，无需 npm 安装第三方包。

1. 双击 `start_server.cmd`，或在本目录运行 `node server.mjs`。
2. 在 Chrome / Edge 或支持设备访问的侧边浏览器打开 `http://127.0.0.1:8770/index.html`。
3. 选择串口或蓝牙连接真实设备。浏览器设备选择框由使用者授权；“模拟设备”仅用于演示。

默认绑定本机 127.0.0.1。需要其他本地端口时设置环境变量 FUSION_WEB_PORT。串口使用 921600 波特率；浏览器访问串口或蓝牙需要支持相应 Web API。

## 功能

- SCA：2–15 点原始数据采集、导入 / 导出、豆 / 粉数据及色值下发、独立回读核对；不要求点位递增或唯一。
- 测量：含水率 / 密度选择豆种、色度选择豆 / 粉、水活度使用设备原测量流程。
- 原始监测：开始 → 结束 → 导出 CSV，按约 200 ms 读取最新有效传感器帧，跳过重复序号。不是采集板每一帧的无损转储。刷新页面前导出本段记录。
- 设备：原有三档亮度、1 / 5 / 10 分钟息屏、蜂鸣器和语言状态切换，原校准入口、SN 一次写入和回读规则。
- 环境：温度 °C、湿度 %RH、当前海拔 m。初始海拔可输入、按米加减或归零；保存时调用设备原 P0 校准及持久化函数。
- 升级：当前串口 / BLE 连接升级；WiFi 升级按电脑连接设备专用热点后上传。选择的是 S3 应用镜像，不能选择 Bootloader、分区表或整片合并镜像。
- 原版局域网：本机服务支持既有 UDP 发现及 TCP 通道，真实同网网络发现的可用性还取决于现场网络。

WiFi 升级的公开出厂默认热点为 `RoastSee-Fusion-OTA`、默认连接口令 `12345678`、地址 `192.168.4.1`。这是升级热点的默认连接参数，不含用户的路由器账号或口令。进入热点会断开原连接；升级或退出热点后恢复正常启动。

## 首次安装及恢复

配套新款固件发布目录为 0.1.2new，应用镜像文件名为 `Three_into_one_0.1.2new.bin`。首次完整安装请使用多合一固件发布包和配套烧录工具。已有网页协议固件时，可在上位机选择配套 S3 应用镜像进行更新。

下载此仓库后也可用本机的应用分区安装器。需要 Python、pyserial 和 esptool 4.x。从配套发布包复制应用镜像、manifest.json 和 partition-table.bin 到本目录的 firmware/，保持清单中指定的镜像文件名。发布包中的分区表在 partition_table/ 子目录。运行 install_firmware.cmd 并按实际端口选择。安装器会备份当前应用和配置，校验后更新当前应用分区。

`backups/` 在本地创建并由网页服务拒绝访问，请勿提交。真机 S/N、标定表、日志及备份不包含在此发布中。

## 验证与数据

运行 `node --test tests/*.test.js`，本次 81 项测试通过。`tests/fixtures/scasave-example.json` 是合成测试样例，不能作为生产标定数据。

界面草稿在当前浏览器保存；导出后自行保管。清空浏览器存储会丢失草稿，刷新会清空尚未导出的当段原始记录。

---

## App 开发协议：适用范围与快速接入

适用多合一 0.1.2new 配套的 S3 软件 **0.1.2 / webProtocol=1 / webFirmware=1.0.19**。App 可直接连接设备，不必经过 Node.js 网页服务。旧固件、旧 BLE 服务和原 C3 内部串口不是下面这套接口。

建议先实现：连接 → 订阅 BLE TX（串口跳过）→ `0x01 INFO` → `0x02 TELEMETRY` → `0x14 MEASURE` → 结果轮询。再实现设置、原始监测和升级。

- 串口：打开主板对应串口，**921600、8 数据位、无校验、1 停止位、无硬件流控**。保持接收循环运行，接收缓冲建议至少 64 KiB。不要通过 DTR / RTS 自动复位设备。
- BLE：按广播名称前缀 `RoastSee Fusion` 查找候选设备，连接后发现下表服务，先完成 TX Notify / CCCD 订阅，再发 INFO。不要只按名称绑定；用 INFO 中的设备标识确认所连设备。
- `INFO.mac` 是设备输出的 WiFi STA MAC 字符串，不保证等于系统 BLE 扫描对象的地址 / ID。App 不应硬编码某台测试机的 MAC。
- 普通业务建议同一时刻只有一个请求在途。升级才按 INFO 能力使用窗口。一个 BLE 会话中的完整帧写入顺序必须串行，不能把两个帧的分片交叉发送。
- 初次握手允许启动等待和有界重试；先核对串口、权限、服务和订阅，不要把一次超时直接判定成需要擦除重刷。

### 1. BLE GATT 服务

| 项目 | UUID | 方向 / 属性 |
| --- | --- | --- |
| 自定义服务 | `f0050001-6d2a-4a9b-b3c1-465553494f4e` | Primary Service |
| RX 特征 | `f0050002-6d2a-4a9b-b3c1-465553494f4e` | App → 设备，Write / Write Without Response |
| TX 特征 | `f0050003-6d2a-4a9b-b3c1-465553494f4e` | 设备 → App，Notify |

普通命令先用有应答写。**GATT 写入成功只表示该次 GATT 操作成功，业务成功必须等待下面的协议应答。** 订阅旧 `0x180D` 服务的 Notify 不能替代订阅此自定义 TX。

本版广播带设备名称和固定厂商示例数据，没有在广播中声明上述 128 位自定义服务 UUID。App 扫描时若强制按该 UUID 过滤，可能完全搜不到；应先按名称发现候选设备，连接后发现服务并读 INFO。厂商示例数据也不是每台唯一的设备身份。

MTU 按实际协商值处理，不能固定假设 256。固件连接时偏好 7.5–15 ms 连接间隔，升级时会尝试较长数据长度 / 2M PHY，这些都是协商偏好，不是 App 可假设已生效的保证。

### 2. 共用二进制业务帧

以下偏移从完整业务帧起点计算。串口直接发送此帧；BLE 先按下一节分片。

| 偏移 | 长度 | 字段 | 规则 |
| --- | ---: | --- | --- |
| 0 | 2 | 同步头 | 固定 `F5 5F` |
| 2 | 1 | 协议版本 | 固定 `01` |
| 3 | 1 | cmd | 请求命令号；应答通常为请求号 OR `0x80` |
| 4 | 2 | seq | uint16，小端；App 使用 1–65535，回绕时避开未完成请求 |
| 6 | 2 | N | 载荷字节数，uint16 小端，0–4096 |
| 8 | N | payload | 随命令定义，可为二进制或 UTF-8 JSON / 文本 |
| 8+N | 4 | CRC32 | uint32 小端，计算范围为偏移 2 到 7+N，共 N+6 字节 |
| 12+N | 2 | 结束标记 | 固定 `0D 0A` |

总长度 **N+14**，最大 4110 字节。CRC32 使用反射多项式 `0xEDB88320`，数值与 Python `zlib.crc32(data)`、本目录 `crc32(data)` 及设备 `esp_rom_crc32_le(0,data,len)` 一致；标准向量 `123456789` 为 `0xCBF43926`。不要把同步头、CRC 字段、结束标记或 BLE 分片头算入此 CRC。

串口是字节流：一次读取可能是半帧、多帧或混有启动 / 控制台文本。接收端累计缓冲，查找同步头，按 N 等待完整帧，并同时校验版本、长度、CRC、结束标记；错误时向前移动 1 字节继续同步。不能按换行或 payload 中出现 `F5 5F` 就切帧。固件串口未完成帧超过约 1 秒会过期，发送完整帧时避免长时间停在中间。

### 3. BLE 分片格式

每次写 RX / 收 TX Notify 的 GATT value 为：**1 字节分片头 + 业务帧的一段字节**。

| 分片头位 | 含义 |
| --- | --- |
| bit 0–5 | 分片序号，从 0 开始，逐片递增，按 64 回绕 |
| bit 6，`0x40` | START，本业务帧第一片 |
| bit 7，`0x80` | END，本业务帧最后一片 |

单片帧头为 `C0`。多片时如 `40 01 82` 表示 3 片的头，序号分别 0 / 1 / 2；这些字节不属于共用业务帧。每个新业务帧都重新从 0 编号，与业务帧内 seq 无关。

建议 GATT value 上限 `min(240, 实际ATT_MTU-3)`，其中再扣 1 字节才是业务帧数据。例如 MTU=23 时 value 最多 20 字节、每片数据最多 19；MTU=256 时本实现使用 value 240、每片数据最多 239。设备 TX 也按实际 MTU 和此上限分片。

收到 START 重置本帧重组；检查分片序号，拼到 END 后再交给业务帧解析器。序号不连续则丢弃不完整帧，等待新 START；接收长度不得无限增长。固件 RX 分片间隔超过约 2 秒会重置重组状态。没有接收端“缺片补发”指令，业务重试必须从完整帧重新开始。

### 4. 应答、事件与错误

普通应答满足 `response.cmd == request.cmd | 0x80`、`response.seq == request.seq`。payload 是 UTF-8 JSON；帧中 N 是 UTF-8 **字节**长度，不是字符数。

```json
{"ok":true,"data":{"example":"该命令定义的数据"}}
```

无数据的成功应答可以只有 `{"ok":true}`。失败示例为 `{"ok":false,"error":"Invalid measurement profile"}`；data 和 error 都不是所有应答必有字段。设备拒绝业务时，不要把 GATT 写成功或串口发完当作命令成功。

旧文本输出事件使用 `cmd=0x90、seq=0`，例如：

```json
{"event":"legacy","text":"demarcate,weigh,12345\r\n"}
```

**`0x10` 的普通应答也恰好是 `0x90`，必须结合 seq 区分：非 0 是请求应答，0 才是事件。** 事件不使用 ok/data 包装。CRC、报文长度错误或命令队列满时可能直接没有应答，App 应处理超时；不能假设每次错误都有 JSON 错误包。

### 5. 命令总表

表中编号为十六进制；“空”表示 N=0，不是字符串 `null`。业务载荷除明确说明外均为二进制字节。

| cmd | 应答 cmd | 用途 | 请求 payload | 成功 data |
| --- | --- | --- | --- | --- |
| `01` | `81` | INFO，设备信息与参数 | 空 | 设备、参数及能力对象 |
| `02` | `82` | TELEMETRY，状态 / 最近结果 | 空 | 实时快照对象 |
| `10` | `90` | 原文本命令兼容 | 指定 UTF-8 命令，含 CRLF | 通常无 data，结果经旧文本事件 |
| `11` | `91` | 参数 JSON 下发 | UTF-8 JSON，不加 NUL / CRLF | INFO 对象 |
| `12` | `92` | 原控制命令 | 固定前缀 + nativeOp + 可选值 | 通常无 data |
| `13` | `93` | 单次 SCA 标定原始采集 | 空 | 延迟返回 raw / powder / been |
| `14` | `94` | 按样品类型启动测量 | kind 1 字节 + profile 1 字节 | INFO，表示请求已接收 |
| `15` | `95` | 传感器连续监测 | op 1 字节 + kind 1 字节 | 监测状态 / 样本 |
| `16` | `96` | 设置初始海拔并保存 | int32 小端，单位米，恰 4 字节 | INFO |
| `36` | `B6` | 进入专用 WiFi 升级模式 | 空 | ssid / url / rebooting |
| `40` | `C0` | 应用 OTA 会话控制 | op + 可选参数 | OTA 状态对象 |
| `41` | `C1` | OTA 写块 | offset:uint32 LE + 固件字节 | offset / crc |

`0xFE` 是固件内部转发，不是 App 指令；没有对外定义通用“取消测量”或“唤醒设备”命令，不要自行占用命令号。

### 6. INFO 与 TELEMETRY 字段

先读取 INFO 确认 `webProtocol==1`。`fw=0.1.2` 是设备软件版本，`webFirmware=1.0.19` 是适配实现版本，`hw=0.0.1` 是硬件标识，三者不要混用。build 为构建日期字符串。

| INFO 字段 | 类型 / 说明 |
| --- | --- |
| name / mac / sn / fw / hw / build | 字符串；sn 为 `NULL` 时表示尚未写入 |
| webProtocol / webFirmware | 数字协议版本 / 字符串适配版本 |
| mode | 0 开发、1 工厂、2 产品模式 |
| measurementProfiles / rawMonitor / environmentCalibration | boolean，相关能力标志；旧固件缺失时禁用对应功能 |
| measureMode | 0 生豆、1 熟豆、2 带壳豆、3 干果 |
| scaMode | 0 咖啡粉、1 咖啡豆 |
| brightness / sleep / buzzer / language | 档位值 / 分钟 / 0关1开 / 0中文1英文 |
| boardPowder / boardBeen | 粉 / 豆校准板色值 |
| linearA / linearB | 原线性补偿系数 |
| makeupPowder / makeupBeen | 原兼容手动补偿字段，当前网页无此设置入口 |
| initialAltitude / pressureReference | 保存的初始海拔（整数米）/ P0 气压基准（Pa） |
| points | `{count,been:[],powder:[],values:[]}`，设备实际保存的点位 |
| serialChunk / serialWindow | 本版 4092 字节 / 8，在途升级块能力 |
| bleChunk / bleWindow | 本版 512 字节 / 2，在途升级块能力 |
| internalFree / internalLargest / internalDmaFree / internalDmaLargest | 内存诊断，字节；不作为测量值 |
| uartEventMonitor / uartFifoOverflows / uartRingOverflows | UART 接收保护及累计溢出诊断 |

points.count 可能反映旧配置；本网页写入接口只开放 2–15 点。App 应按应答中的实际 count 读取数组，不固定假设 9 点。

| TELEMETRY 字段 | 单位 / 含义 |
| --- | --- |
| link | 采集板在线 boolean，不是主板 GATT 连接标志 |
| moisture / density / aw / sca | 含水率 % / 密度 g/L / 水活度（无量纲）/ 设备色度值 |
| temperature / humidity / altitude | °C / %RH / m；设备按原公式输出 |
| initialAltitude / pressureReference | 已保存初始高度和 P0，同 INFO，可用于同步实体屏幕上的设置 |
| pressure / battery | Pa / mV，battery 不是电量百分比 |
| temperatureRaw / humidityRaw | 原传感器整数读数，不是 °C / %RH |
| weightADC / capacitance / scaADC | 重量 ADC / 电容原值 / SCA 原始 ADC，不是克重或最终色值 |
| measuringMD / measuringAW / measuringSCA | 相应测量当前是否执行 |
| measurementBusy | 测量、校准、排队或 SCA 单次采集综合占用 |
| measureMode / scaMode | 当前样品选择，与 INFO 一致 |

通常每秒查询 `02`。`link=false` 时不要把保留的数值显示为有效新测量；字段为 null / 缺失时显示无有效数据。0 可能是有效数值，不能用“非 0”代替 valid / 在线判断。

### 7. 测量与 SCA 单次采集

#### 7.1 启动正常测量：cmd 14

| kind | 测量 | profile |
| --- | --- | --- |
| 1 | 含水率 / 密度 | 0 生豆、1 熟豆、2 带壳豆、3 干果 |
| 2 | 水活度 | 必须 0 |
| 3 | 色度 | 0 咖啡粉、1 咖啡豆 |

例如测咖啡粉色度，payload 为 `03 00`；测生豆含水率 / 密度为 `01 00`。合法 profile 会同步到设备原测量流程及对应保存字段。不要为了选择豆 / 粉另造 JSON 字段。

`94` 成功返回 INFO 只代表已接收，不能立即把之前的 sca / moisture 当成本次结果。继续查询 `02`，记录 busy 及相应 measuring 标志的启动和结束，并检查 link。网页最长观察 180 秒；App 可按产品需求设定测量等待时间。

本版没有独立的测量任务 ID / 最终成功码。设备原有错误、断线及超时也可能使 busy 结束；App 应结合在线状态和设备状态，不能仅凭 busy 变 false 就宣称样品测量成功。仅看到短暂排队占用也不能证明传感器实际开始测量。

#### 7.2 标定点读取：cmd 13

payload 空。它触发设备原 SCA 采样流程，完成后才以同一个请求 seq 返回：

```json
{"ok":true,"data":{"raw":200000,"powder":52.5,"been":53.1}}
```

以上是合成示意。raw 是原始 ADC；powder / been 是设备按当前参数算出的粉 / 豆色值。读取不会自动写点位。App 应把 raw 填入当前选择的粉 / 豆点，再由用户明确下发参数。

固件采集回传关联窗口约 45 秒；没有结果时本版不保证主动发送超时错误包，客户端建议等待最多 60 秒并自行处理未完成状态。普通 8 秒请求超时不适合此命令。

### 8. 连续原始数据监测：cmd 15

payload 恰 2 字节：`[op,kind]`。op=1 开始、2 获取最新样本并续租、3 停止；kind=1 重量 ADC、2 电容原值、3 SCA 原始 ADC。

重量监测示例：`01 01` 开始 → 每约 200 ms 请求 `02 01` → `03 01` 结束。

```json
{"ok":true,"data":{"active":true,"kind":1,"seq":12,"deviceMs":25100,"valid":true,"value":12345}}
```

- data.seq 是监测样本序号，和帧头 seq 不同；每次新监测重新计数。仅在 valid=true、value 为有限数、样本序号更新时追加记录。value=0 仍可能是有效读数。
- deviceMs 为设备运行时计时，不是日期 / Unix 时间。App 自行记录主机采集时间、开始 / 结束时间和设备标识。
- 第一次尚无样本时 valid=false，value 可以缺失。开始 / 停止应答也不能当成新样本。
- 同时只能监测一个通道，由发起的传输通道持有。必须从同一通道读取 / 停止；不能让串口开始、BLE 接管。
- 5 秒没有获取样本心跳会释放；BLE 断开或实体屏幕开始原测量时也会释放。读取最新值不代表采集板每帧无损上传。
- 结束后由 App 导出 CSV / 保存数据库；固件没有“下载历史 CSV”指令，普通遥测 02 也不续这个监测租约。

### 9. 参数、校准板和 SCA 点位下发：cmd 11

payload 为 UTF-8 JSON，N 使用编码后的字节数。以下各例均为格式示意，不是生产标定数据，按操作分别发送，不合并无关配置：

```json
{"calibrat_board":{"powder":50.0,"been":50.0}}
```

```json
{"linearFit":{"A":0.0,"B":0.0}}
```

```json
{"SCA_Piont":{"SCA_Parameter_points":3,"SCA_Been_Point":[100000,200000,300000],"SCA_Pink_Point":[110000,210000,310000],"SCA_Y_Point":[10.0,50.0,90.0]}}
```

**`SCA_Piont`、`SCA_Been_Point`、`SCA_Pink_Point`、`calibrat_board` 的拼写是既有协议，不能改成其它英文拼法。** Pink 在这里对应“粉”，不是颜色选择。

点数必须为整数 2–15；三个数组都至少有 N 个有限数值，App 应发送恰好 N 项。按输入顺序保存，不要求原始数据逐点递增或唯一，不要擅自排序 / 去重。

成功 data 是 INFO，核对 boardPowder / boardBeen、linearA / linearB 或 points 的 count 和全部元素。随后再发一次 INFO 独立回读；float32 保存后比较使用数值容差，不能只比较原 JSON 字符串。网页容差为 `max(1e-5, abs(发送值)*1e-6)`。

#### SN 与产品模式

读取 INFO，只有 sn 字符串精确等于 `NULL` 时才允许首次下发 `{"SN":"实际设备SN"}`。SN 为 1–19 个 UTF-8 字节，不是 19 个任意字符。既有 Qt 生成约定是 `LB + YYMMDD + 8位Base36大写随机码 + RF`，固件接口本身按字节长度校验。

写入后精确核对 sn 和 mode=2。有 SN 的设备不会覆盖；原处理函数可能仍回复 ok=true 和旧 INFO，因此 **ok=true 不等于新 SN 已写入**。App 不应提供覆盖已有 SN 的入口。

此接口复用原保存流程；未知 JSON 字段没有通用“必定拒绝”保证。App 应只发送文档白名单并核对对应字段，不靠未知字段试探设备。

### 10. 原控制封装与初始海拔

#### 10.1 cmd 12：固定前缀 + nativeOp

16 字节固定前缀为：

```text
A6 C3 CA 4B 9C 1C 46 B8 58 E9 4B D1 D2 A5 56 A6
```

该前缀放在外层 cmd=12 的 payload 中，其后是 1 字节 nativeOp 及可选参数。它不是外层同步头。下表 nativeOp 同样为十六进制：

| nativeOp | 功能 | 前缀之后的字节 |
| --- | --- | --- |
| `01` / `02` / `03` | 原 MD / AW / SCA 测量入口 | 仅 op；常规 App 推荐改用 cmd 14 以明确样品类型 |
| `04` / `05` | 蜂鸣器开 / 关 | 仅 op；回读 buzzer=1 / 0 |
| `06` / `07` | 中文 / 英文 | 仅 op；回读 language=0 / 1 |
| `08` | 屏幕亮度 | op + uint8：低 5、中 25、高 50 |
| `09` | 息屏时间 | op + uint8：1、5、10，单位分钟 |
| `0A` | 含水率归零 / 校准入口 | 仅 op |
| `0B` | 密度归零 / 校准入口 | 仅 op |
| `0C` | 水活度校准入口 | 仅 op |
| `0D` | 色度校准入口 | 仅 op |

例如高亮度 payload 为 `前缀 + 08 32`，10 分钟息屏为 `前缀 + 09 0A`。这里 uint8 的 50 对应十六进制 32，不能发送 ASCII 字符串“50”。亮度和息屏在 App 中只展示原设备的三档。

无额外参数的 native payload 为 17 字节；亮度 / 息屏为 18 字节。命令号、参数范围和长度应在 App 发送前校验，不要依赖旧兼容解析器自动纠正。

语言切换会等待界面应用完成后才确认；测量期间会拒绝语言切换。其余设置 / 校准的成功 ACK 不一定等于界面流程已经完成。蜂鸣器、语言、亮度、息屏应再读 INFO 核对；重选当前语言时不必重复写入和重建界面。含水率 / 密度共用实体校准界面，0A / 0B 是其中两个步骤，不应做成两个独立的最终标定模型。

兼容层还保留 nativeOp `0F` 的旧 WiFi 配置：前缀 + `0F` + UTF-8 `WIFI:<ssid>;SD:<password>;` + `00` 终止，总 payload 最长 127 字节；旧解析按非空白串取值并限长，不适合带空白的名称。它可能将配置写入旧控制台日志，当前网页没有这个入口，常规 App 不应默认开放，也不要用它代替 cmd 36 的升级热点流程。

nativeOp `11` / `12` 是旧粉 / 豆手动补偿：前缀 + op + **float32 大端**，payload 恰 21 字节。这里只记录兼容格式；当前网页没有该功能入口，不属于新增 App 必需功能。仅此旧浮点字段采用大端，外层帧仍小端。nativeOp `0E` / `10` 被网页适配入口拒绝。

#### 10.2 cmd 16：设置初始海拔

payload 为 int32 小端整数米，恰好 4 字节。例如 +123 m 是 `7B 00 00 00`，−20 m 是 `EC FF FF FF`。点击加减或归零只改 App 草稿，用户点击保存时才发送。

需要 INFO.environmentCalibration=true；采集板离线 / 气压无效、测量、监测或升级占用时不能保存。固件调用实体海拔界面原有校准函数，保存并核对 NVS 中的高度和 P0 后返回 INFO。App 再独立读取 INFO，确认 initialAltitude 与目标一致、pressureReference 为有限正数，再刷新 TELEMETRY。

当前 altitude 会随实际气压变化，不能一直强行显示成 initialAltitude，也不要在 App 中另写一套海拔补偿覆盖设备结果。

### 11. 串口 / BLE 应用 OTA

只升级 S3 应用，App 不向固件发送 Bootloader / 分区表的绝对烧录地址。先验证镜像为本产品 ESP32-S3 应用：0xE9 镜像头、chip_id=9、应用描述符 magic=0xABCD5432、project_name=NV3049F，大小不超过 4 MiB。可参考 `validateFirmware()`。

cmd 40 的 payload 第一个字节是以下 op：

| op | 操作 | 后续 payload | 说明 |
| --- | --- | --- | --- |
| `01` | START | size:uint32 LE + 全镜像CRC32:uint32 LE | 总 payload 恰 9 字节，开始写非活动分区 |
| `02` | QUERY | 无 | 返回当前会话 / 已写入校验断点并续会话计时 |
| `03` | FINISH | 无 | 验证完整镜像并设置启动分区，成功 state=ready |
| `04` | ABORT | 无 | 未提交镜像可中止；ready 时拒绝取消 |
| `05` | REBOOT | 无 | 只在本通道镜像已验证时接受，先 ACK 后约 1 秒重启 |

控制应答 data 示例：

```json
{"state":"receiving","size":100000,"expectedCrc":123456789,"offset":4092,"crc":987654321}
```

state 为 idle / receiving / ready。CRC 均为 JSON 非负数值，不是十六进制字符串；示例数值仅说明类型。offset 是设备已接受字节数，crc 是从镜像 0 到 offset 的累计 CRC。

crc / expectedCrc 按无符号 32 位处理，可大于 2147483647。App 若使用有符号整型保存位模式，写 JSON 时仍需转换为 0–4294967295 范围，不能发送负 CRC。

判断空闲以 state 为准：ABORT 后 size / expectedCrc 可以保留旧值，不能以 size 是否为 0 代替状态判断。

cmd 41 的 payload 为 `offset:uint32 LE + 本块固件字节`，至少 5 字节。块 ACK data 精简为 `{"offset":下一偏移,"crc":累计CRC}`，不要要求每个块都带 state / size。偏移必须恰好等于设备当前 offset，不支持乱序写和盲目重发已写块。

推荐流程：

1. INFO 获取 chunk / window 能力，QUERY 查看会话。receiving 时核对 size、expectedCrc、offset 和本地前缀 CRC；不一致就停止，不覆盖其它通道的会话。
2. idle 时 START。按连续 offset 写块；本版串口最多 4092 字节固件数据 / 块、8 块在途，BLE 512 字节 / 块、2 块在途。offset 的 4 字节计入 payload，因此串口上限正好 4096。
3. ACK 偏移和累计 CRC 均核对后推进进度。发送顺序要连续；BLE 只在逻辑帧边界并发等待 ACK，仍串行发送各完整帧的分片。
4. 块超时或偏移错误时，先等待 / 收敛所有已发送在途块，再 QUERY，从已校验断点恢复。不要保留旧写入任务同时恢复 / 取消。
5. 全部字节写完再次 QUERY，核对 offset=size、crc=全包 CRC。FINISH 必须返回 ready，之后才 REBOOT；重连读取 INFO 确认同一设备及实际版本。

BLE 升级可以使用无应答快速写，每 2 个 GATT 分片暂停约 1 ms 是现网页的节流策略。异常时先降突发量、窗口到 1 并校验断点，连续成功再恢复；反复异常再退回有应答写。MTU 较小时应降低块大小 / 窗口。速度由实际链路决定，2M PHY 不是必然可用。

同一 OTA 会话属于一个传输通道，不能串口开始后让 BLE 接管。receiving 超过约 120 秒无有效块或 QUERY 会自动取消。断开并重连后也必须 QUERY，不能只凭 App 本地进度恢复；同一通道会话可能仍在超时窗口内。ready 已提交启动分区，不允许用 ABORT 撤销；断连本身也不等于升级成功。

### 12. WiFi 升级入口：cmd 36

通过现有串口或 BLE 发空 payload。成功 data 包括 `ssid`、`url`、`rebooting=true`，设备随后重启为专用 AP 模式，原连接断开属于预期流程。

App / 系统连接 `RoastSee-Fusion-OTA`（公开默认口令 12345678）后：

- `GET http://192.168.4.1/info`：先核对 webProtocol=1、mode=`ap-ota`、INFO.mac 与先前设备一致，避免传给另一台 Fusion。
- `POST http://192.168.4.1/ota?crc=<全镜像CRC32的十六进制>`：Content-Type=`application/octet-stream`，正文是完整应用 bin，不使用串口帧或 BLE 分片。CRC 参数不超过 8 个十六进制字符；文件长度作为请求 Content-Length，不能把未知长度流当成有效镜像长度。
- HTTP 成功且正文精确为 `OK-rebooting` 才确认设备已校验并安排重启。仅上传进度 100% 或 HTTP 2xx 不是完整成功条件。
- `POST /back`：空闲时返回 `OK-back-rebooting` 并退出热点。上传中不能退出；热点启动约 10 分钟且无上传占用时会自动回正常启动，不以该期限中断上传。

WiFi HTTP 接口不使用通用 ok/data JSON 包装（/info 自身是 JSON 对象，/ota 和 /back 为上述文本）。App 仍需处理系统网络切换和设备重连。

### 13. 原文本与旧 BLE 兼容边界

cmd 10 只允许下列 UTF-8 文本，必须包括结尾 CRLF：`device_get\r\n`、`weigh_get\r\n`、`cap_get\r\n`、`sca_get\r\n`。请求的普通 ACK 与 seq=0 的 legacy 结果事件分开，事件可能早于 ACK，不能假设先后顺序；不要期待文本直接作为 ACK data。

典型文本为 `demarcate,weigh,<原始值>\r\n`、`demarcate,cap,<原始值>,\r\n`。旧事件路由依赖最近处理请求的传输来源；多个通道并发时不可依赖其送达原发起端。新 App 使用 INFO、13、15 获得关联更明确的结果。

原 `0x180D` 服务仍存在：0x2A37 为旧通知，0x2A38 为旧 Read / Write 控制入口（读取版本形如 `HW0.0.1SW0.1.2`）；0x180A 下还有制造商 / 型号读取。这里只用于旧 App 兼容，**不要将上面的 F5 5F 业务帧写进旧 0x2A38，也不要把原 native 前缀直接写进自定义 RX 而漏掉业务帧与 BLE 分片头。**

### 14. App 状态机、超时及未定义能力

| 项目 | 当前网页采用 / App 对接建议 |
| --- | --- |
| 普通业务 | 默认等待 8 秒；超时不自动当作业务失败后可任意重写 |
| 语言切换 | 等待约 6 秒并回读；固件确认窗口约 3 秒 |
| 启动测量 / 保存海拔 | 请求等待约 15 秒；测量完成另行观察 |
| SCA 单次采集 13 | 客户端等待最多约 60 秒；固件结果关联窗口约 45 秒 |
| 监测取样 / 停止 | 约 2.5 秒请求超时；取样心跳必须小于 5 秒租约 |
| OTA 控制 / 开始擦写 | 客户端最长约 60 秒，避免以普通请求超时误判 |
| OTA 数据块 | BLE 约 8 秒，串口约 15 秒；错误后先 QUERY |
| WiFi 上传 | 当前网页最多约 300 秒，并校验最终成功文本 |

读 INFO / TELEMETRY 不等于硬件唤醒或禁止休眠，设备仍使用原电源策略。App 应处理息屏 / 休眠后的失联、用户重新唤醒和重新连接，不能把所有停止响应都当作程序崩溃。

固件对连续监测、升级、语言、海拔和测量启动有相应占用检查，但不是每个旧配置命令都具备完整的测量互斥。App 应在 measurementBusy 或本端操作未结束时禁用参数写入 / 校准 / 新测量；不要把“原固件可能接受”当成可以并行修改系数的依据。INFO / TELEMETRY 可用于状态观察。

读取可以在确认连接后有界重试；写参数、SN、启动测量等超时后先查询状态，不能盲重发。序号按未完成请求隔离，断连时清理全部等待者、重组缓冲和旧发送队列。记录导出由 App 负责；目前没有设备历史列表、通用测量取消、通用唤醒、恢复出厂或 SN 覆盖接口。

本业务协议没有定义 App 登录、权限令牌或消息加密字段。CRC 用于传输检错，不能当成 App 身份认证。后续 App 的生产调试 / 参数写入权限应明确设计，不要假设当前固件会识别 App 用户身份。

常见拒绝的处理建议如下；本版 error 是文本，未定义独立数值错误码，不能把这些文本当作跨版本不变的错误枚举：

| error 示例 | App 处理 |
| --- | --- |
| `Device busy` / `Measurement or calibration already active` | 等待原操作结束，不自动再次启动 |
| `Diagnostic monitor active; stop recording first` | 从原通道停止记录，再执行写入 |
| `Monitor stopped or lease expired` | 结束本段本地记录；需要时重新显式开始 |
| `Session owned by another channel` | 不跨通道抢占升级 |
| `Invalid parameter JSON or SCA points` | 检查字段拼写、数值、点数及数组，不直接重发同一错误载荷 |
| `Offset or length mismatch` | 收敛在途写入，再 QUERY 和核对前缀 CRC |
| `Full image CRC32 mismatch` | 不重启到新应用，重新核对文件与会话 |
| `Image already committed; reboot required` | 已 ready，不能当成可撤销的普通会话 |
| `Language change not confirmed` | 查询 INFO 确认实际语言，不按按钮的期望值显示成功 |
| `Initial altitude not confirmed in storage` | 不宣布保存成功，重新读取高度 / P0 及检查设备状态 |

### 15. 可直接验证的报文示例

下面十六进制串是完整业务帧，字节之间可自行加空格；不要按这些字符的 ASCII 发送。

| 用途 | cmd / seq / payload | 完整帧（含 CRC） |
| --- | --- | --- |
| INFO | 01 / 0x1234 / 空 | `f55f0101341200005e4315270d0a` |
| 咖啡粉色度测量 | 14 / 1 / 03 00 | `f55f0114010002000300c72f61700d0a` |
| 初始海拔 +123 m | 16 / 2 / 7B 00 00 00 | `f55f0116020004007b000000455a18b60d0a` |
| 蜂鸣器开 | 12 / 3 / 前缀 + 04 | `f55f011203001100a6c3ca4b9c1c46b858e94bd1d2a556a604b7568ba40d0a` |

上面 INFO 帧在 MTU=23 时也能放进一个 BLE value，发送为 `c0f55f0101341200005e4315270d0a`。前面的 c0 是 BLE 分片头，串口不能加这个字节。

以下 Python 仅演示跨语言一致的编码，不包含平台串口 / BLE 权限和连接代码：

```python
import struct
import zlib

def make_frame(cmd, seq, payload=b""):
    if not 1 <= seq <= 65535 or len(payload) > 4096:
        raise ValueError("seq/payload out of range")
    body = struct.pack("<BBHH", 1, cmd, seq, len(payload)) + payload
    crc = zlib.crc32(body) & 0xFFFFFFFF
    return b"\xF5\x5F" + body + struct.pack("<I", crc) + b"\r\n"

def ble_fragments(packet, att_mtu=23):
    value_limit = min(240, att_mtu - 3)
    if value_limit < 2:
        raise ValueError("invalid MTU")
    data_limit = value_limit - 1
    for index, pos in enumerate(range(0, len(packet), data_limit)):
        part = packet[pos:pos + data_limit]
        flags = (index & 0x3F) | (0x40 if pos == 0 else 0)
        if pos + len(part) == len(packet):
            flags |= 0x80
        yield bytes([flags]) + part

assert make_frame(0x01, 0x1234).hex() == "f55f0101341200005e4315270d0a"
height_packet = make_frame(0x16, 2, struct.pack("<i", 123))
assert height_packet.hex() == "f55f0116020004007b000000455a18b60d0a"
```

对接时以请求 seq 关联应答，先去掉 BLE 分片头，再校验业务帧 CRC，最后解析 UTF-8 JSON。原始 ADC、最终色值、已保存初始高度、当前海拔和主机显示草稿是不同的数据，模型中应分别保存。

### 16. 实现对照与维护

- [fusion_protocol.js](fusion_protocol.js)：CRC、帧编解码、BLE 分片、指令号和原 native 参数。
- [fusion_link.js](fusion_link.js)：串口接收、GATT 订阅、写入序列化、请求 / 应答关联。
- [fusion_measurement.js](fusion_measurement.js)、[fusion_recording.js](fusion_recording.js)：样品映射、测量和连续监测。
- [fusion_settings.js](fusion_settings.js)、[fusion_environment.js](fusion_environment.js)：设置及初始海拔的回读确认。
- [fusion_ota.js](fusion_ota.js)、[fusion_wifi.js](fusion_wifi.js)：升级窗口、重试、断点 CRC 和热点身份核对。
- 固件源码 main/src/fusion_web.c：实际协议、能力字段、占用、错误及 OTA / HTTP 实现。
- 固件源码 main/src/user_ble.c、main/src/tcp_client.c：原 native 与参数保存兼容入口。

本次补充仅为协议文档，没有新增命令、修改固件或调整测量 / 标定公式。后续若更改线协议，应同时更新协议版本 / 能力标志、本章示例及相应测试，不依据页面按钮文字反推字节格式。
