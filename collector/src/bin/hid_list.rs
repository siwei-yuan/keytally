fn main() {
    let api = hidapi::HidApi::new().expect("hidapi");
    for i in api.device_list() {
        println!(
            "vid={:04x} pid={:04x} usage_page={:04x} usage={:02x} product={:?}",
            i.vendor_id(), i.product_id(), i.usage_page(), i.usage(),
            i.product_string().unwrap_or("?")
        );
    }
}
