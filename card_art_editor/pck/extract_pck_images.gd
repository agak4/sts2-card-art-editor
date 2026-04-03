extends SceneTree

const IMAGE_EXTENSIONS := ["png", "jpg", "jpeg", "webp", "gif"]
const TEXTURE_RESOURCE_EXTENSIONS := ["ctex", "stex"]
const SCANNED_TEXT_EXTENSIONS := [".png", ".jpg", ".jpeg", ".webp", ".gif", ".ctex", ".stex", ".png.import", ".jpg.import", ".jpeg.import", ".webp.import", ".gif.import"]
const PCK_MAGIC := 0x43504447 # GDPC
const HEADER_VERSION_FIELDS := 4
const HEADER_RESERVED_FIELDS := 16


func _initialize() -> void:
	var args = OS.get_cmdline_user_args()
	if args.size() < 2:
		push_error("Usage: extract_pck_images.gd <input_pck> <output_dir>")
		quit(ERR_INVALID_PARAMETER)
		return

	var input_pck = args[0]
	var output_dir = args[1]
	DirAccess.make_dir_recursive_absolute(output_dir)

	var parsed = _parse_pck_entries(input_pck)
	if !bool(parsed.get("ok", false)):
		push_error(String(parsed.get("message", "Could not parse PCK.")))
		quit(ERR_FILE_CORRUPT)
		return

	var entries: Array = parsed.get("entries", [])
	var scanned_candidates: Array = _collect_candidate_paths_from_pck(input_pck)
	var exported_files: Array = []
	var exported_index := {}

	for entry in entries:
		_export_entry_from_pck(input_pck, entry, output_dir, exported_files, exported_index)

	if exported_files.is_empty():
		for candidate_path in scanned_candidates:
			_try_export_candidate(String(candidate_path), entries, input_pck, output_dir, exported_files, exported_index)

	var metadata_path = output_dir.path_join("metadata.json")
	var metadata_file = FileAccess.open(metadata_path, FileAccess.WRITE)
	if metadata_file != null:
		metadata_file.store_string(JSON.stringify({
			"count": exported_files.size(),
			"entry_count": entries.size(),
			"candidate_count": scanned_candidates.size(),
			"files": exported_files,
			"sample_candidates": scanned_candidates.slice(0, min(20, scanned_candidates.size()))
		}, "\t"))

	print("ENTRIES=%d" % entries.size())
	print("CANDIDATES=%d" % scanned_candidates.size())
	print("EXPORTED=%d" % exported_files.size())
	quit()


func _parse_pck_entries(pck_path: String) -> Dictionary:
	var file = FileAccess.open(pck_path, FileAccess.READ)
	if file == null:
		return {
			"ok": false,
			"message": "Could not open PCK file: %s" % pck_path
		}

	if file.get_length() < 4:
		return {
			"ok": false,
			"message": "The selected PCK file is too small to be valid."
		}

	var magic = file.get_32()
	if magic != PCK_MAGIC:
		return {
			"ok": false,
			"message": "The selected file is not a supported Godot PCK archive."
		}

	for _index in range(HEADER_VERSION_FIELDS):
		file.get_32()
	for _index in range(HEADER_RESERVED_FIELDS):
		file.get_32()

	if file.get_position() + 4 > file.get_length():
		return {
			"ok": false,
			"message": "The PCK header ended unexpectedly."
		}

	var file_count = file.get_32()
	var entries: Array = []
	for _index in range(file_count):
		if file.get_position() + 4 > file.get_length():
			break
		var path_length = file.get_32()
		if path_length <= 0 or file.get_position() + path_length > file.get_length():
			break
		var path = file.get_buffer(path_length).get_string_from_utf8()
		if file.get_position() + 8 + 8 + 16 > file.get_length():
			break
		var offset = file.get_64()
		var size = file.get_64()
		file.get_buffer(16)
		entries.append({
			"path": _normalize_pck_entry_path(path),
			"offset": offset,
			"size": size
		})

	return {
		"ok": true,
		"entries": entries
	}


func _normalize_pck_entry_path(path: String) -> String:
	var normalized = path.replace("\\", "/").strip_edges()
	if normalized.begins_with("res://"):
		return normalized
	return "res://%s" % normalized.trim_prefix("/")


func _export_entry_from_pck(pck_path: String, entry: Dictionary, output_root: String, exported_files: Array, exported_index: Dictionary) -> void:
	var entry_path = String(entry.get("path", ""))
	if entry_path == "":
		return
	var extension = entry_path.get_extension().to_lower()
	if !IMAGE_EXTENSIONS.has(extension) and !TEXTURE_RESOURCE_EXTENSIONS.has(extension):
		return
	var output_extension = extension
	var output_rel = entry_path.trim_prefix("res://")
	if TEXTURE_RESOURCE_EXTENSIONS.has(extension):
		output_rel = output_rel.trim_suffix(".%s" % extension) + ".png"
		output_extension = "png"
	var output_path = output_root.path_join(output_rel)
	if exported_index.has(output_path):
		return

	var bytes = _read_pck_entry_bytes(pck_path, entry)
	if bytes.is_empty():
		return

	DirAccess.make_dir_recursive_absolute(output_path.get_base_dir())
	if IMAGE_EXTENSIONS.has(extension):
		var out_file = FileAccess.open(output_path, FileAccess.WRITE)
		if out_file == null:
			return
		out_file.store_buffer(bytes)
		exported_index[output_path] = true
		exported_files.append(output_path)
		return

	var image = _load_image_from_buffer(bytes, output_extension)
	if image == null:
		return
	if image.save_png(output_path) != OK:
		return
	exported_index[output_path] = true
	exported_files.append(output_path)


func _read_pck_entry_bytes(pck_path: String, entry: Dictionary) -> PackedByteArray:
	var file = FileAccess.open(pck_path, FileAccess.READ)
	if file == null:
		return PackedByteArray()
	var offset = int(entry.get("offset", 0))
	var size = int(entry.get("size", 0))
	if offset < 0 or size <= 0:
		return PackedByteArray()
	if offset + size > file.get_length():
		return PackedByteArray()
	file.seek(offset)
	return file.get_buffer(size)


func _collect_candidate_paths_from_pck(pck_path: String) -> Array:
	var data = FileAccess.get_file_as_bytes(pck_path)
	if data.is_empty():
		return []
	var strings = _extract_printable_strings(data)
	var paths := {}
	for text in strings:
		var lower_text = text.to_lower()
		for extension in SCANNED_TEXT_EXTENSIONS:
			if lower_text.ends_with(extension):
				paths[_normalize_pck_entry_path(text)] = true
				break
	return paths.keys()


func _try_export_candidate(candidate_path: String, entries: Array, pck_path: String, output_root: String, exported_files: Array, exported_index: Dictionary) -> void:
	var normalized = _normalize_pck_entry_path(candidate_path)
	var variants: Array = [normalized]
	if normalized.ends_with(".import"):
		variants.append(normalized.trim_suffix(".import"))
	if normalized.get_extension().to_lower() in TEXTURE_RESOURCE_EXTENSIONS:
		variants.append(normalized.trim_suffix(".%s" % normalized.get_extension().to_lower()) + ".png")

	for variant in variants:
		var matched_entry = _find_entry_by_path(entries, variant)
		if !matched_entry.is_empty():
			_export_entry_from_pck(pck_path, matched_entry, output_root, exported_files, exported_index)


func _find_entry_by_path(entries: Array, target_path: String) -> Dictionary:
	var normalized_target = _normalize_pck_entry_path(target_path)
	for entry in entries:
		var entry_path = String((entry as Dictionary).get("path", ""))
		if entry_path == normalized_target:
			return entry
	return {}


func _load_image_from_buffer(bytes: PackedByteArray, extension: String):
	var image = Image.new()
	var load_error = ERR_FILE_UNRECOGNIZED
	match extension:
		"png":
			load_error = image.load_png_from_buffer(bytes)
		"jpg", "jpeg":
			load_error = image.load_jpg_from_buffer(bytes)
		"webp":
			load_error = image.load_webp_from_buffer(bytes)
		_:
			return null
	if load_error != OK:
		return null
	return image


func _extract_printable_strings(data: PackedByteArray) -> Array:
	var results: Array = []
	var current := PackedByteArray()
	for byte in data:
		var is_printable = (byte >= 48 and byte <= 57) or (byte >= 65 and byte <= 90) or (byte >= 97 and byte <= 122) or byte == 46 or byte == 47 or byte == 95 or byte == 45
		if is_printable:
			current.append(byte)
			continue
		if current.size() >= 8:
			results.append(current.get_string_from_ascii())
		current = PackedByteArray()
	if current.size() >= 8:
		results.append(current.get_string_from_ascii())
	return results
