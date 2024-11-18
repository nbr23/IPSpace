class CIDRRange {
	constructor(cidr) {
		const [addr, prefix] = cidr.split('/');
		this.prefix = parseInt(prefix);
		if (isNaN(this.prefix) || this.prefix < 0 || this.prefix > 32) {
			throw new Error('Invalid prefix length');
		}

		this.start = (this.ipToLong(addr) & 0xFFFFFFFF) >>> 0;
		const hostBits = 32 - this.prefix;
		let mask = (0xFFFFFFFF >>> hostBits) << hostBits;
		if (this.prefix === 0) {
			mask = 0;
		}

		if (this.prefix === 32) {
			this.end = this.start;
			this.prettyStart = this.longToIp(this.start);
			this.prettyEnd = this.prettyStart;
			this.prettyMask = this.longToIp(mask);
			this.size = 2 ** (32 - this.prefix);
			return;
		}


		if (this.longToIp(this.start) != this.longToIp(this.start & mask)) {
			throw new Error(`IP address not properly aligned with network mask ${this.longToIp(this.start)} != ${this.longToIp(this.start & mask)} ${cidr}`);
		}

		this.end = (this.start | (0xFFFFFFFF >>> this.prefix)) >>> 0;

		this.prettyStart = this.longToIp(this.start);
		this.prettyEnd = this.longToIp(this.end);
		this.prettyMask = this.longToIp(mask);
		this.size = 2 ** (32 - this.prefix);
	}

	ipToLong(ip) {
		const parts = ip.split('.');
		if (parts.length !== 4) {
			throw new Error('Invalid IP address format');
		}

		return parts.reduce((sum, octet) => {
			const num = parseInt(octet);
			if (isNaN(num) || num < 0 || num > 255) {
				throw new Error('Invalid IP address octet');
			}
			return (sum << 8) + num;
		}, 0);
	}

	static findLargestPossibleCIDR(startIp, endIp) {
		const range = endIp - startIp + 1;
		if (range <= 0) return null;

		const maxPower = Math.floor(Math.log2(range));

		const blockSize = 1 << maxPower;
		const mask = ~(blockSize - 1);
		const alignedStart = startIp & mask;

		try {
			if (alignedStart < startIp) {
				return new CIDRRange(`${this.longToIp(startIp)}/${32 - maxPower + 1}`);
			}

			if (alignedStart + blockSize - 1 > endIp) {
				return new CIDRRange(`${this.longToIp(startIp)}/${32 - maxPower + 1}`);
			}

			return new CIDRRange(`${this.longToIp(startIp)}/${32 - maxPower}`);
		} catch (err) {
			console.error(`Failed to findLargestPossibleCIDR(${this.longToIp(startIp)}, ${this.longToIp(endIp)})`, err);
		}
	}

	longToIp(long) {
		return [
			(long >>> 24) & 255,
			(long >>> 16) & 255,
			(long >>> 8) & 255,
			long & 255,
		].join('.');
	}

	static longToIp(long) {
		return [
			(long >>> 24) & 255,
			(long >>> 16) & 255,
			(long >>> 8) & 255,
			long & 255,
		].join('.');
	}

	contains(other) {
		return this.start <= other.start && this.end >= other.end;
	}

	toString() {
		return `${this.longToIp(this.start)}/${this.prefix}`;
	}
}
