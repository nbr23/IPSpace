function getParamsFromUrl() {
	const params = new URLSearchParams(window.location.search);
	return {
		vpc: params.get('vpc') || '',
		subnets: params.get('subnets') ? decodeURIComponent(params.get('subnets')).split(',').join('\n') : ''
	};
}

function updateUrlParams(vpc, subnets) {
	const params = new URLSearchParams();
	if (vpc) params.set('vpc', vpc);
	if (subnets) params.set('subnets', encodeURIComponent(subnets.split('\n').filter(s => s.trim()).join(',')));

	const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
	window.history.pushState({}, '', newUrl);
}

function initializeFromUrl() {
	const { vpc, subnets } = getParamsFromUrl();
	document.getElementById('vpc-cidr').value = vpc;
	document.getElementById('subnet-cidrs').value = subnets;

	if (vpc || subnets) {
		ShowIPSpace();
	}
}

function showCopyNotification(text) {
	let notification = document.getElementById('copy-notification');
	if (!notification) {
		notification = document.createElement('div');
		notification.id = 'copy-notification';
		notification.className = 'copy-notification';
		document.body.appendChild(notification);
	}

	notification.textContent = `Copied: ${text}`;
	notification.classList.add('show');
	setTimeout(() => {
		notification.classList.remove('show');
	}, 2000);
}

function checkOverlaps(subnets) {
	const overlaps = [];

	for (let i = 0; i < subnets.length; i++) {
		for (let j = i + 1; j < subnets.length; j++) {
			const a = subnets[i];
			const b = subnets[j];

			if (!(a.end < b.start || b.end < a.start)) {
				overlaps.push({
					subnet1: a,
					subnet2: b,
				});
			}
		}
	}

	return overlaps;
}

function ShowIPSpace() {
	const vpcCidrInput = document.getElementById('vpc-cidr').value;
	const subnetCidrsInput = document.getElementById('subnet-cidrs').value;


	const vizContainer = document.getElementById('viz');
	const statsContainer = document.getElementById('stats');
	const errorContainer = document.getElementById('error');

	updateUrlParams(vpcCidrInput, subnetCidrsInput);

	vizContainer.innerHTML = '';
	statsContainer.innerHTML = '';
	errorContainer.innerHTML = '';

	try {
		const vpcBlock = new CIDRRange(vpcCidrInput);
		const vpcSize = vpcBlock.size;
		const vpcStart = vpcBlock.prettyStart;
		const vpcEnd = vpcBlock.prettyEnd;

		const subnetBlocks = subnetCidrsInput
			.split('\n')
			.map(cidr => cidr.trim())
			.filter(cidr => cidr.length > 0)
			.map(cidr => {
				const block = new CIDRRange(cidr);
				if (!vpcBlock.contains(block)) {
					throw new Error(`Subnet ${cidr} is not within VPC range`);
				}
				return block;
			})
			.sort((a, b) => a.start - b.start);

		const overlaps = checkOverlaps(subnetBlocks);

		if (overlaps.length > 0) {
			const errorList = document.createElement('div');
			errorList.className = 'error-list';
			errorList.innerHTML = `
                <strong>Warning: Overlapping Subnets Detected!</strong>
                <ul>
                    ${overlaps.map(({ subnet1, subnet2 }) => `
                        <li>${subnet1.toString()} overlaps with ${subnet2.toString()}</li>
                    `).join('')}
                </ul>
            `;
			errorContainer.appendChild(errorList);
		}

		const overlappingSubnets = new Set();
		overlaps.forEach(({ subnet1, subnet2 }) => {
			overlappingSubnets.add(subnet1.toString());
			overlappingSubnets.add(subnet2.toString());
		});

		let usedIPs = 0;
		let lastEnd = vpcBlock.start - 1;
		let fragments = [];

		subnetBlocks.forEach(block => {
			if (block.start > lastEnd + 1) {
				fragments.push({
					type: 'empty',
					start: lastEnd + 1,
					end: block.start - 1,
					startOffset: (lastEnd + 1 - vpcBlock.start) / vpcSize,
					width: (block.start - lastEnd - 1) / vpcSize * 100
				});
			}

			fragments.push({
				type: 'subnet',
				block,
				startOffset: (block.start - vpcBlock.start) / vpcSize,
				width: block.size / vpcSize * 100
			});

			usedIPs += block.size;
			lastEnd = block.end;
		});

		if (lastEnd < vpcBlock.end) {
			fragments.push({
				type: 'empty',
				start: lastEnd + 1,
				end: vpcBlock.end,
				startOffset: (lastEnd + 1 - vpcBlock.start) / vpcSize,
				width: (vpcBlock.end - lastEnd) / vpcSize * 100
			});
		}

		fragments.forEach(fragment => {
			const el = document.createElement('div');
			el.style.left = `${fragment.startOffset * 100}%`;
			el.style.width = `${fragment.width}%`;
			el.style.position = 'absolute';
			el.style.height = '100%';

			if (fragment.type === 'subnet') {
				el.className = 'subnet';

				const info = document.createElement('div');
				info.className = 'subnet-info';
				info.textContent = fragment.block.toString();
				el.appendChild(info);

				const tooltip = document.createElement('div');
				tooltip.className = 'tooltip';
				tooltip.innerHTML = `
                    <strong>CIDR:</strong> ${fragment.block.toString()}<br>
                    <strong>Start:</strong> ${fragment.block.longToIp(fragment.block.start)}<br>
                    <strong>End:</strong> ${fragment.block.longToIp(fragment.block.end)}<br>
                    <strong>Size:</strong> ${fragment.block.size.toLocaleString()} IPs
                `;
				el.appendChild(tooltip);
			} else {
				el.className = 'empty-space';
				const largestPossibleCIDR = CIDRRange.findLargestPossibleCIDR(fragment.start, fragment.end);
				if (!largestPossibleCIDR) {
					return;
				}
				const tooltip = document.createElement('div');
				tooltip.className = 'tooltip';
				tooltip.innerHTML = `
                    <strong>Empty Space</strong><br>
                    <strong>Start:</strong> ${CIDRRange.longToIp(fragment.start)}<br>
                    <strong>End:</strong> ${CIDRRange.longToIp(fragment.end)}<br>
                    <strong>Size:</strong> ${(fragment.end - fragment.start + 1).toLocaleString()} IPs<br>
                    <strong>Largest possible CIDR:</strong> ${largestPossibleCIDR ? largestPossibleCIDR.toString() : 'N/A'}
                `;
				el.appendChild(tooltip);
				el.addEventListener('click', async (e) => {
					e.stopPropagation();
					const cidrString = largestPossibleCIDR.toString();

					try {
						await navigator.clipboard.writeText(cidrString);
						showCopyNotification(cidrString);
					} catch (err) {
						const textArea = document.createElement('textarea');
						textArea.value = cidrString;
						document.body.appendChild(textArea);
						textArea.select();
						try {
							document.execCommand('copy');
							showCopyNotification(cidrString);
						} catch (err) {
							console.error('Failed to copy:', err);
						}
						document.body.removeChild(textArea);
					}
				});
			}

			vizContainer.appendChild(el);
		});

		const remainingIPs = vpcSize - usedIPs;
		statsContainer.innerHTML = `
            <strong>VPC Size:</strong> ${vpcSize.toLocaleString()} IPs<br>
			<strong>NetMask:</strong>${vpcBlock.prettyMask} = ${vpcBlock.prefix}<br>
			<strong>HostMin:</strong>${vpcBlock.prettyStart}<br>
			<strong>HostMax:</strong>${vpcBlock.prettyEnd}<br>
            <strong>Used:</strong> ${usedIPs.toLocaleString()} IPs (${(usedIPs / vpcSize * 100).toFixed(2)}%)<br>
            <strong>Available:</strong> ${remainingIPs.toLocaleString()} IPs (${(remainingIPs / vpcSize * 100).toFixed(2)}%)
        `;

	} catch (error) {
		errorContainer.textContent = error.message;
	}
}


window.addEventListener('load', initializeFromUrl);

document.getElementById('vpc-cidr').addEventListener('change', ShowIPSpace);
document.getElementById('subnet-cidrs').addEventListener('change', ShowIPSpace);
